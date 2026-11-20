import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { plan, release, StoreError, storeClient } from "../scripts/publish.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = "https://chromewebstore.googleapis.com";
const item = "publishers/pub-id/items/item-id";
const zip = Buffer.from("PK fake zip");

// A store that answers each method from its own list of responses, in order,
// and records every request.
function fakeStore(answers, clientOptions = {}) {
	const requests = [];
	const fetch = async (url, init) => {
		requests.push({ url, ...init });
		const method = url.slice(url.lastIndexOf(":") + 1);
		const next = answers[method]?.shift();
		assert.ok(next, `no answer left for ${method}`);
		const { status = 200, ...body } = next;
		return new Response(JSON.stringify(body), { status });
	};
	const client = storeClient({
		token: "test-token",
		publisherId: "pub-id",
		itemId: "item-id",
		fetch,
		...clientOptions,
	});
	const lines = [];
	const waits = [];
	const run = (options) =>
		release({
			client,
			zip,
			version: "1.2.0",
			log: (line) => lines.push(line),
			wait: async (ms) => waits.push(ms),
			...options,
		});
	const called = () =>
		requests.map((r) => r.url.slice(r.url.lastIndexOf(":") + 1));
	return { requests, lines, waits, run, called };
}

const published = (version) => ({
	state: "PUBLISHED",
	distributionChannels: [{ crxVersion: version, deployPercentage: 100 }],
});
const live = { publishedItemRevisionStatus: published("1.1.0") };

test("uploads the zip, then submits it for review", async () => {
	const store = fakeStore({
		fetchStatus: [live],
		upload: [{ uploadState: "SUCCEEDED", crxVersion: "1.2.0" }],
		publish: [{ state: "PENDING_REVIEW", itemId: "item-id" }],
	});
	assert.deepEqual(await store.run(), { state: "PENDING_REVIEW" });

	const [status, upload, publish] = store.requests;
	assert.equal(status.method, "GET");
	assert.equal(status.url, `${base}/v2/${item}:fetchStatus`);
	assert.equal(upload.method, "POST");
	assert.equal(upload.url, `${base}/upload/v2/${item}:upload`);
	assert.equal(upload.body, zip);
	assert.equal(upload.headers["Content-Type"], "application/zip");
	assert.equal(publish.method, "POST");
	assert.equal(publish.url, `${base}/v2/${item}:publish`);
	assert.equal(publish.body, "{}");
	for (const request of store.requests) {
		assert.equal(request.headers.Authorization, "Bearer test-token");
	}
	assert.ok(
		store.lines.includes("Submitted 1.2.0 for review: PENDING_REVIEW."),
	);
});

test("waits for an upload in progress before submitting", async () => {
	const store = fakeStore({
		fetchStatus: [
			live,
			{ lastAsyncUploadState: "IN_PROGRESS" },
			{ lastAsyncUploadState: "SUCCEEDED" },
		],
		upload: [{ uploadState: "IN_PROGRESS" }],
		publish: [{ state: "PENDING_REVIEW" }],
	});
	await store.run({ pollEvery: 5000 });
	assert.deepEqual(store.waits, [5000, 5000]);
	assert.deepEqual(store.called(), [
		"fetchStatus",
		"upload",
		"fetchStatus",
		"fetchStatus",
		"publish",
	]);
});

test("gives up on an upload that stays in progress", async () => {
	const store = fakeStore({
		fetchStatus: [
			live,
			...Array(5).fill({ lastAsyncUploadState: "IN_PROGRESS" }),
		],
		upload: [{ uploadState: "IN_PROGRESS" }],
	});
	await assert.rejects(
		store.run({ pollEvery: 5000, pollFor: 15000 }),
		/still in progress after 15 s/,
	);
	assert.equal(store.waits.length, 3);
	assert.ok(!store.called().includes("publish"));
});

test("doesn't submit a failed upload", async () => {
	const store = fakeStore({
		fetchStatus: [live],
		upload: [{ uploadState: "FAILED" }],
	});
	await assert.rejects(store.run(), /The upload ended FAILED/);
	assert.ok(!store.called().includes("publish"));
});

test("doesn't submit a package the store reads another version in", async () => {
	const store = fakeStore({
		fetchStatus: [live],
		upload: [{ uploadState: "SUCCEEDED", crxVersion: "1.1.5" }],
	});
	await assert.rejects(store.run(), /read 1\.1\.5 in the package, not 1\.2\.0/);
	assert.ok(!store.called().includes("publish"));
});

test("says what the store refused, without the token", async () => {
	const store = fakeStore({
		fetchStatus: [
			{
				status: 403,
				error: {
					code: 403,
					status: "PERMISSION_DENIED",
					message: "The caller does not have permission",
				},
			},
		],
	});
	const error = await store.run().catch((e) => e);
	assert.ok(error instanceof StoreError);
	assert.match(
		error.message,
		/403: PERMISSION_DENIED: The caller does not have permission/,
	);
	assert.match(error.message, /Developer Dashboard/);
	assert.doesNotMatch(error.message, /test-token/);
});

test("waits for a review in progress instead of uploading over it", async () => {
	const store = fakeStore({
		fetchStatus: [
			{
				...live,
				submittedItemRevisionStatus: {
					state: "PENDING_REVIEW",
					distributionChannels: [{ crxVersion: "1.1.1" }],
				},
			},
		],
	});
	await assert.rejects(store.run(), /1\.1\.1 is still in review/);
	assert.deepEqual(store.called(), ["fetchStatus"]);
});

test("does nothing for a version already submitted or published", async () => {
	for (const status of [
		{
			...live,
			submittedItemRevisionStatus: {
				state: "PENDING_REVIEW",
				distributionChannels: [{ crxVersion: "1.2.0" }],
			},
		},
		{ publishedItemRevisionStatus: published("1.2.0") },
	]) {
		const store = fakeStore({ fetchStatus: [status] });
		const result = await store.run();
		assert.equal(result.skipped, true);
		assert.deepEqual(store.called(), ["fetchStatus"]);
	}
});

test("uploads again over a rejected submission of the same version", async () => {
	const store = fakeStore({
		fetchStatus: [
			{
				...live,
				submittedItemRevisionStatus: {
					state: "REJECTED",
					distributionChannels: [{ crxVersion: "1.2.0" }],
				},
			},
		],
		upload: [{ uploadState: "SUCCEEDED", crxVersion: "1.2.0" }],
		publish: [{ state: "PENDING_REVIEW" }],
	});
	assert.equal((await store.run()).state, "PENDING_REVIEW");
});

test("refuses a version that isn't above the published one", async () => {
	const store = fakeStore({
		fetchStatus: [{ publishedItemRevisionStatus: published("1.3.0") }],
	});
	await assert.rejects(
		store.run(),
		/1\.2\.0 isn't above the published 1\.3\.0/,
	);
	assert.deepEqual(store.called(), ["fetchStatus"]);
});

test("a dry run only reads the status", async () => {
	const store = fakeStore({ fetchStatus: [live] });
	assert.deepEqual(await store.run({ dryRun: true }), { state: "DRY_RUN" });
	assert.deepEqual(store.called(), ["fetchStatus"]);
	assert.ok(store.lines.includes("Published: 1.1.0"));
});

test("shows the store's warnings on a submission", async () => {
	const store = fakeStore({
		fetchStatus: [live],
		upload: [{ uploadState: "SUCCEEDED", crxVersion: "1.2.0" }],
		publish: [
			{
				state: "PENDING_REVIEW",
				warningInfo: {
					warnings: [
						{ reason: "SOME_REASON", description: "Something to fix" },
					],
				},
			},
		],
	});
	await store.run();
	assert.ok(store.lines.includes("Warning (SOME_REASON): Something to fix"));
});

test("the command names the variables it's missing", () => {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith("CWS_")),
	);
	const result = spawnSync(
		process.execPath,
		[join(root, "scripts/publish.js"), "package.zip"],
		{ env: { ...env, CWS_PUBLISHER_ID: "pub-id" }, encoding: "utf8" },
	);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Missing: CWS_ACCESS_TOKEN, CWS_EXTENSION_ID/);
});

test("a dry run says what a real run would do", async () => {
	const cases = [
		[live, /A real run would upload 1\.2\.0 and submit it for review/],
		[
			{ publishedItemRevisionStatus: published("1.2.0") },
			/A real run would skip it: 1\.2\.0 is already published/,
		],
		[
			{ publishedItemRevisionStatus: published("1.3.0") },
			/A real run would stop: 1\.2\.0 isn't above the published 1\.3\.0/,
		],
	];
	for (const [status, line] of cases) {
		const store = fakeStore({ fetchStatus: [status] });
		assert.deepEqual(await store.run({ dryRun: true }), { state: "DRY_RUN" });
		assert.ok(
			store.lines.some((l) => line.test(l)),
			store.lines.join("\n"),
		);
		assert.deepEqual(store.called(), ["fetchStatus"]);
	}
});

test("every release channel counts, as during a percentage rollout", () => {
	const rollout = (...versions) => ({
		publishedItemRevisionStatus: {
			state: "PUBLISHED",
			distributionChannels: versions.map((crxVersion) => ({ crxVersion })),
		},
	});
	assert.deepEqual(plan(rollout("1.1.0", "1.2.0"), "1.2.0"), {
		skip: "1.2.0 is already published.",
		state: "PUBLISHED",
	});
	assert.throws(
		() => plan(rollout("1.1.0", "1.3.0"), "1.2.0"),
		/isn't above the published 1\.3\.0/,
	);
	assert.deepEqual(plan(rollout("1.1.0", "1.1.1"), "1.2.0"), {});
});

test("a store that doesn't answer fails the call, after the time limit", async () => {
	// A real request's socket keeps the process alive while it waits; this
	// timer stands in for it (AbortSignal.timeout's own timer doesn't).
	const hang = async (_url, init) =>
		new Promise((_, reject) => {
			const socket = setTimeout(() => {}, 5000);
			init.signal.addEventListener("abort", () => {
				clearTimeout(socket);
				reject(init.signal.reason);
			});
		});
	const client = storeClient({
		token: "test-token",
		publisherId: "pub-id",
		itemId: "item-id",
		fetch: hang,
		timeout: 20,
	});
	await assert.rejects(
		client.fetchStatus(),
		(error) =>
			error instanceof StoreError &&
			/GET fetchStatus: no answer after 0\.02 s/.test(error.message),
	);
});

test("a network failure is a store error that names the cause", async () => {
	const offline = async () => {
		throw new TypeError("fetch failed", {
			cause: new Error("getaddrinfo ENOTFOUND chromewebstore.googleapis.com"),
		});
	};
	const client = storeClient({
		token: "test-token",
		publisherId: "pub-id",
		itemId: "item-id",
		fetch: offline,
	});
	await assert.rejects(
		client.publish(),
		(error) =>
			error instanceof StoreError &&
			/POST publish: fetch failed \(getaddrinfo ENOTFOUND/.test(error.message),
	);
});

// The command checks the zip's manifest before it talks to the store.
const scratch = mkdtempSync(join(tmpdir(), "publish-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Without the store variables, nor the ones Info-ZIP reads extra options from
// (the release workflow once set ZIP).
const cleanEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([k]) =>
			!k.startsWith("CWS_") &&
			!["ZIP", "ZIPOPT", "UNZIP", "UNZIPOPT"].includes(k),
	),
);

function command(zipPath) {
	return spawnSync(
		process.execPath,
		[join(root, "scripts/publish.js"), zipPath],
		{
			env: {
				...cleanEnv,
				CWS_ACCESS_TOKEN: "test-token",
				CWS_PUBLISHER_ID: "pub-id",
				CWS_EXTENSION_ID: "item-id",
			},
			encoding: "utf8",
		},
	);
}

test("the command refuses a zip that holds another version", () => {
	writeFileSync(join(scratch, "manifest.json"), '{ "version": "9.9.9" }');
	execFileSync("zip", ["-q", "other.zip", "manifest.json"], {
		cwd: scratch,
		env: cleanEnv,
	});
	const result = command(join(scratch, "other.zip"));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /holds version 9\.9\.9, and manifest\.json says/);
});

test("the command refuses a file that isn't a package", () => {
	writeFileSync(join(scratch, "not-a.zip"), "nope");
	const result = command(join(scratch, "not-a.zip"));
	assert.equal(result.status, 1);
	assert.match(result.stderr, /no readable manifest\.json/);
});
