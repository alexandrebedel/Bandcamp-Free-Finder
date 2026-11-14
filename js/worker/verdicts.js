// Answers "is this release free?": from the cache when possible, otherwise
// through a queue that runs 3 page reads at a time, on-screen covers first.
// Two tabs asking about the same release share one read.

import { releaseKey, verdictFromHtml } from "../shared/verdict.js";
import { readCache, writeCache } from "./cache.js";
import { createQueue } from "./queue.js";
import { fetchSaleHtml } from "./sale-page.js";

// Bandcamp answers 429 when a label page fires dozens of requests at once.
const MAX_CONCURRENT = 3;

const inflight = new Map();
const queue = createQueue(MAX_CONCURRENT);

async function readVerdict(key) {
	const verdict = verdictFromHtml(await fetchSaleHtml(key));
	if (verdict.kind !== "unknown") {
		await writeCache(key, verdict);
	}
	return verdict;
}

// `urgent`: the cover is on screen, so it skips ahead of the off-screen ones.
export async function getVerdict(href, urgent) {
	const key = releaseKey(href);
	const cached = await readCache(key);
	if (cached) {
		return cached;
	}
	if (inflight.has(key)) {
		if (urgent) {
			queue.prioritize([key]);
		}
		return inflight.get(key);
	}
	const job = queue
		.add(key, () => readVerdict(key), { urgent })
		.finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}

// Pending covers that scrolled into view, in reading order.
export function prioritize(hrefs) {
	queue.prioritize(hrefs.map(releaseKey));
}
