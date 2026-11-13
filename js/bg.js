import { isReleaseUrl, releaseKey, verdictFromHtml } from "./verdict.js";

// Bump when the verdict format or rules change, so stale entries are ignored.
const CACHE_PREFIX = "v1:";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
// Bandcamp answers 429 when a label page fires dozens of requests at once.
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
// A long Retry-After would hold a slot with no extension activity, long
// enough for Chrome to stop the worker and drop every queued request.
const MAX_RETRY_WAIT_S = 10;

const inflight = new Map();
const queue = [];
let active = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function schedule(task) {
	return new Promise((resolve, reject) => {
		queue.push({ task, resolve, reject });
		pump();
	});
}

function pump() {
	while (active < MAX_CONCURRENT && queue.length > 0) {
		const { task, resolve, reject } = queue.shift();
		active++;
		task()
			.then(resolve, reject)
			.finally(() => {
				active--;
				pump();
			});
	}
}

async function fetchHtml(url) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { credentials: "omit" });
		if (res.ok) {
			return res.text();
		}
		if (res.status !== 429 || attempt >= MAX_RETRIES) {
			throw new Error(`HTTP ${res.status} for ${url}`);
		}
		const retryAfter = Number(res.headers.get("retry-after"));
		const waitS = Math.min(retryAfter || 2 ** attempt * 2, MAX_RETRY_WAIT_S);
		await sleep(waitS * 1000);
	}
}

async function readCache(key) {
	const cacheKey = CACHE_PREFIX + key;
	const { [cacheKey]: entry } = await chrome.storage.local.get(cacheKey);
	if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
		return entry.verdict;
	}
	return null;
}

async function writeCache(key, verdict) {
	await chrome.storage.local.set({
		[CACHE_PREFIX + key]: { verdict, at: Date.now() },
	});
}

async function getVerdict(href) {
	const key = releaseKey(href);
	const cached = await readCache(key);
	if (cached) {
		return cached;
	}
	if (!inflight.has(key)) {
		const job = schedule(async () => {
			const verdict = verdictFromHtml(await fetchHtml(key));
			if (verdict.kind !== "unknown") {
				await writeCache(key, verdict);
			}
			return verdict;
		}).finally(() => inflight.delete(key));
		inflight.set(key, job);
	}
	return inflight.get(key);
}

// Drops expired verdicts and those from older cache versions, and leaves
// any other key in storage alone.
async function pruneCache() {
	const all = await chrome.storage.local.get(null);
	const stale = Object.entries(all)
		.filter(
			([k, v]) =>
				/^v\d+:/.test(k) &&
				(!k.startsWith(CACHE_PREFIX) ||
					Date.now() - (v?.at ?? 0) >= CACHE_TTL_MS),
		)
		.map(([k]) => k);
	if (stale.length > 0) {
		await chrome.storage.local.remove(stale);
	}
}

chrome.runtime.onInstalled.addListener(pruneCache);
chrome.runtime.onStartup.addListener(pruneCache);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type === "bff:verdict") {
		if (!isReleaseUrl(msg.url)) {
			// e.g. a label grid linking to an artist's custom domain.
			sendResponse({ kind: "unknown" });
			return false;
		}
		getVerdict(msg.url).then(sendResponse, (err) => {
			console.warn("[bandcamp-free-finder]", err);
			sendResponse({ kind: "unknown" });
		});
		return true;
	}

	if (msg?.type === "bff:count" && sender.tab?.id !== undefined) {
		const tabId = sender.tab.id;
		chrome.action.setBadgeText({
			tabId,
			text: msg.count > 0 ? String(msg.count) : "",
		});
		// Same sticker green and ink as the band on the covers.
		chrome.action.setBadgeBackgroundColor({ tabId, color: "#3ee07f" });
		chrome.action.setBadgeTextColor({ tabId, color: "#04150b" });
		chrome.action.setTitle({
			tabId,
			title:
				msg.count > 0
					? `${msg.count} free release${msg.count > 1 ? "s" : ""} on this page`
					: "Bandcamp Free Finder",
		});
	}
	return false;
});
