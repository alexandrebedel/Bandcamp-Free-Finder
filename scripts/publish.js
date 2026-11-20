// Uploads the package to the Chrome Web Store and submits it for review, with
// the store's V2 API: https://developer.chrome.com/docs/webstore/using-api
//   node scripts/publish.js <zip> [--dry-run]
// Reads CWS_ACCESS_TOKEN (an OAuth token with the chromewebstore scope; the
// release workflow gets one for a service account), CWS_PUBLISHER_ID and
// CWS_EXTENSION_ID. --dry-run only reads the item's status: it checks the
// credentials, says what a real run would do, and changes nothing.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { compareVersions } from "./version.js";

const API = "https://chromewebstore.googleapis.com";

// A refusal from the store, or a state the release can't go on from.
export class StoreError extends Error {}

// The API calls for one item. A call that gets no answer within `timeout` ms
// (`uploadTimeout` for the upload) fails. `fetch` is there for the tests.
export function storeClient({
	token,
	publisherId,
	itemId,
	fetch = globalThis.fetch,
	timeout = 60_000,
	uploadTimeout = 300_000,
}) {
	const item = `publishers/${publisherId}/items/${itemId}`;

	async function call(method, url, { body, type, limit = timeout } = {}) {
		const headers = { Authorization: `Bearer ${token}` };
		if (type) headers["Content-Type"] = type;
		const what = `${method} ${url.slice(url.lastIndexOf(":") + 1)}`;
		let response;
		let text;
		try {
			response = await fetch(url, {
				method,
				headers,
				body,
				signal: AbortSignal.timeout(limit),
			});
			text = await response.text();
		} catch (error) {
			if (error?.name === "TimeoutError") {
				throw new StoreError(
					`Chrome Web Store API, ${what}: no answer after ${limit / 1000} s.`,
				);
			}
			if (error instanceof TypeError) {
				const cause = error.cause?.message ?? error.cause ?? "";
				throw new StoreError(
					`Chrome Web Store API, ${what}: ${error.message}${cause ? ` (${cause})` : ""}`,
				);
			}
			throw error;
		}
		let data = {};
		try {
			data = text ? JSON.parse(text) : {};
		} catch {}
		if (!response.ok)
			throw new StoreError(apiError(response.status, data, text));
		return data;
	}

	return {
		fetchStatus: () => call("GET", `${API}/v2/${item}:fetchStatus`),
		upload: (zip) =>
			call("POST", `${API}/upload/v2/${item}:upload`, {
				body: zip,
				type: "application/zip",
				limit: uploadTimeout,
			}),
		publish: () =>
			call("POST", `${API}/v2/${item}:publish`, {
				body: "{}",
				type: "application/json",
			}),
	};
}

function apiError(status, data, text) {
	const error = data.error;
	const what = error
		? [error.status, error.message].filter(Boolean).join(": ")
		: text.slice(0, 500);
	let message = `Chrome Web Store API, ${status}: ${what}`;
	if (error?.details?.length) {
		message += `\n${JSON.stringify(error.details, null, 2)}`;
	}
	if (status === 401) {
		message +=
			"\nThe access token was refused: it needs the chromewebstore scope, and expires after a while.";
	} else if (status === 403) {
		message +=
			"\nIs the service account's email added in the Developer Dashboard, in the publisher's Settings?";
	} else if (status === 404) {
		message += "\nCheck CWS_PUBLISHER_ID and CWS_EXTENSION_ID.";
	}
	return message;
}

// The versions of a revision, one per release channel (two during a
// percentage rollout).
const versionsOf = (revision) =>
	(revision?.distributionChannels ?? [])
		.map((channel) => channel.crxVersion)
		.filter(Boolean);

const highest = (versions) =>
	versions.reduce(
		(top, v) => (top === undefined || compareVersions(v, top) > 0 ? v : top),
		undefined,
	);

// Submitted states that need nothing more from us.
const SUBMITTED = [
	"PENDING_REVIEW",
	"STAGED",
	"PUBLISHED",
	"PUBLISHED_TO_TESTERS",
];

// What a run does with this status: { skip, state } when `version` is
// already there, {} to upload it. Throws a StoreError when it can't go on.
export function plan(status, version) {
	const published = versionsOf(status.publishedItemRevisionStatus);
	const submitted = status.submittedItemRevisionStatus;
	if (published.includes(version)) {
		return { skip: `${version} is already published.`, state: "PUBLISHED" };
	}
	if (
		versionsOf(submitted).includes(version) &&
		SUBMITTED.includes(submitted.state)
	) {
		return { skip: `${version} is already submitted.`, state: submitted.state };
	}
	if (submitted?.state === "PENDING_REVIEW") {
		throw new StoreError(
			`${highest(versionsOf(submitted)) ?? "Another version"} is still in review. Wait for it, or cancel it in the Developer Dashboard, then run this again.`,
		);
	}
	const top = highest(published);
	if (top && compareVersions(version, top) <= 0) {
		throw new StoreError(
			`${version} isn't above the published ${top}: bump the version.`,
		);
	}
	return {};
}

// Uploads `zip` (holding `version`) and submits it. Running it again for a
// version already submitted does nothing, so a failed run can be re-run. A
// dry run only reads the status and says what a real run would do.
export async function release({
	client,
	zip,
	version,
	dryRun = false,
	log = console.log,
	wait = sleep,
	pollEvery = 5000,
	pollFor = 300_000,
}) {
	const status = await client.fetchStatus();
	const submitted = status.submittedItemRevisionStatus;
	const published = versionsOf(status.publishedItemRevisionStatus);
	log(`Published: ${published.join(", ") || "nothing"}`);
	if (submitted) {
		log(
			`Submitted: ${versionsOf(submitted).join(", ") || "?"} (${submitted.state})`,
		);
	}
	if (status.takenDown)
		log("Warning: the item is taken down (see the dashboard).");
	if (status.warned)
		log("Warning: the item has a policy warning (see the dashboard).");

	let next;
	try {
		next = plan(status, version);
	} catch (error) {
		if (!dryRun || !(error instanceof StoreError)) throw error;
		log(
			`Dry run: the credentials work. A real run would stop: ${error.message}`,
		);
		return { state: "DRY_RUN" };
	}
	if (dryRun) {
		log(
			`Dry run: the credentials work. A real run would ${next.skip ? `skip it: ${next.skip}` : `upload ${version} and submit it for review.`}`,
		);
		return { state: "DRY_RUN" };
	}
	if (next.skip) {
		log(next.skip);
		return { state: next.state, skipped: true };
	}

	log(`Uploading ${version}...`);
	const upload = await client.upload(zip);
	let state = upload.uploadState;
	for (let waited = 0; state === "IN_PROGRESS"; waited += pollEvery) {
		if (waited >= pollFor) {
			throw new StoreError(
				`The upload was still in progress after ${pollFor / 1000} s.`,
			);
		}
		await wait(pollEvery);
		state = (await client.fetchStatus()).lastAsyncUploadState;
	}
	if (state !== "SUCCEEDED") {
		throw new StoreError(`The upload ended ${state ?? "without a state"}.`);
	}
	if (upload.crxVersion && upload.crxVersion !== version) {
		throw new StoreError(
			`The store read ${upload.crxVersion} in the package, not ${version}.`,
		);
	}

	const submission = await client.publish();
	for (const w of submission.warningInfo?.warnings ?? []) {
		log(`Warning (${w.reason}): ${w.description}`);
	}
	if (submission.state === "REJECTED" || submission.state === "CANCELLED") {
		throw new StoreError(`The submission was ${submission.state}.`);
	}
	log(`Submitted ${version} for review: ${submission.state}.`);
	return { state: submission.state };
}

async function main(args) {
	const zipPath = args.find((a) => !a.startsWith("--"));
	const dryRun = args.includes("--dry-run");
	const names = ["CWS_ACCESS_TOKEN", "CWS_PUBLISHER_ID", "CWS_EXTENSION_ID"];
	const missing = names.filter((name) => !process.env[name]);
	if (!zipPath || missing.length) {
		console.error("Usage: node scripts/publish.js <zip> [--dry-run]");
		if (missing.length) console.error(`Missing: ${missing.join(", ")}`);
		process.exitCode = 1;
		return;
	}
	const { version } = JSON.parse(
		readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
	);
	// The store reads the version from the package, and only says so on a
	// quick upload: check the zip's manifest before sending anything.
	let zipped;
	try {
		zipped = JSON.parse(
			execFileSync("unzip", ["-p", zipPath, "manifest.json"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}),
		).version;
	} catch {
		console.error(`${zipPath}: no readable manifest.json in it.`);
		process.exitCode = 1;
		return;
	}
	if (zipped !== version) {
		console.error(
			`${zipPath} holds version ${zipped}, and manifest.json says ${version}.`,
		);
		process.exitCode = 1;
		return;
	}
	const client = storeClient({
		token: process.env.CWS_ACCESS_TOKEN,
		publisherId: process.env.CWS_PUBLISHER_ID,
		itemId: process.env.CWS_EXTENSION_ID,
	});
	try {
		const { state } = await release({
			client,
			zip: readFileSync(zipPath),
			version,
			dryRun,
		});
		if (process.env.GITHUB_STEP_SUMMARY) {
			appendFileSync(
				process.env.GITHUB_STEP_SUMMARY,
				`Chrome Web Store: ${version}, ${state}\n`,
			);
		}
	} catch (error) {
		if (!(error instanceof StoreError)) throw error;
		console.error(error.message);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main(process.argv.slice(2));
}
