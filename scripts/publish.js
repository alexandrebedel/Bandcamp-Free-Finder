// Uploads the package to the Chrome Web Store and submits it for review, with
// the store's V2 API: https://developer.chrome.com/docs/webstore/using-api
//   node scripts/publish.js <zip> [--dry-run]
// Reads CWS_ACCESS_TOKEN (an OAuth token with the chromewebstore scope; the
// release workflow gets one for a service account), CWS_PUBLISHER_ID and
// CWS_EXTENSION_ID. --dry-run only reads the item's status: it checks the
// credentials and changes nothing.
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { compareVersions } from "./version.js";

const API = "https://chromewebstore.googleapis.com";

// A refusal from the store, or a state the release can't go on from.
export class StoreError extends Error {}

// The API calls for one item. `fetch` is there for the tests.
export function storeClient({
	token,
	publisherId,
	itemId,
	fetch = globalThis.fetch,
}) {
	const item = `publishers/${publisherId}/items/${itemId}`;

	async function call(method, url, { body, type } = {}) {
		const headers = { Authorization: `Bearer ${token}` };
		if (type) headers["Content-Type"] = type;
		const response = await fetch(url, { method, headers, body });
		const text = await response.text();
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
			"\nIs the service account's email added in the Developer Dashboard (Account), for this publisher?";
	} else if (status === 404) {
		message += "\nCheck CWS_PUBLISHER_ID and CWS_EXTENSION_ID.";
	}
	return message;
}

const versionOf = (revision) => revision?.distributionChannels?.[0]?.crxVersion;

// Submitted states that need nothing more from us.
const SUBMITTED = [
	"PENDING_REVIEW",
	"STAGED",
	"PUBLISHED",
	"PUBLISHED_TO_TESTERS",
];

// Uploads `zip` (holding `version`) and submits it. Running it again for a
// version already submitted does nothing, so a failed run can be re-run.
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
	const published = versionOf(status.publishedItemRevisionStatus);
	const submitted = status.submittedItemRevisionStatus;
	log(`Published: ${published ?? "nothing"}`);
	if (submitted) {
		log(`Submitted: ${versionOf(submitted) ?? "?"} (${submitted.state})`);
	}
	if (status.takenDown)
		log("Warning: the item is taken down (see the dashboard).");
	if (status.warned)
		log("Warning: the item has a policy warning (see the dashboard).");

	if (dryRun) {
		log(`Dry run: the credentials work; ${version} isn't uploaded.`);
		return { state: "DRY_RUN" };
	}
	if (published === version) {
		log(`${version} is already published.`);
		return { state: "PUBLISHED", skipped: true };
	}
	if (versionOf(submitted) === version && SUBMITTED.includes(submitted.state)) {
		log(`${version} is already submitted.`);
		return { state: submitted.state, skipped: true };
	}
	if (submitted?.state === "PENDING_REVIEW") {
		throw new StoreError(
			`${versionOf(submitted)} is still in review. Wait for it, or cancel it in the Developer Dashboard, then run this again.`,
		);
	}
	if (published && compareVersions(version, published) <= 0) {
		throw new StoreError(
			`${version} isn't above the published ${published}: bump the version.`,
		);
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
