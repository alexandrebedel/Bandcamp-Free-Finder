// Answers "is this release free?": from the cache when possible, otherwise
// by reading the release page. Each Bandcamp host gets its own queue, so a
// label that's being rate-limited doesn't hold up the others; within a
// host, on-screen covers go first. Two tabs asking about the same release
// share one read.

import { releaseKey, verdictFromHtml } from "../shared/verdict.js";
import { readCache, writeCache } from "./cache.js";
import { createQueue } from "./queue.js";
import { fetchSaleHtml } from "./sale-page.js";

// Page reads at once per host; pace.js spaces them out further.
const MAX_PER_HOST = 3;

const inflight = new Map();
const queues = new Map();

function queueFor(key) {
	const host = new URL(key).host;
	let queue = queues.get(host);
	if (!queue) {
		queue = createQueue(MAX_PER_HOST);
		queues.set(host, queue);
	}
	return queue;
}

async function readVerdict(key) {
	const verdict = verdictFromHtml(await fetchSaleHtml(key));
	if (verdict.kind !== "unknown") {
		await writeCache(key, verdict);
	}
	return verdict;
}

async function clearWhenSettled(key, read) {
	try {
		return await read;
	} finally {
		inflight.delete(key);
	}
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
			queueFor(key).prioritize([key]);
		}
		return inflight.get(key);
	}
	const read = queueFor(key).add(key, () => readVerdict(key), { urgent });
	// Shared before anything is awaited: a second ask must find it in `inflight`.
	const job = clearWhenSettled(key, read);
	inflight.set(key, job);
	return job;
}

// Pending covers that scrolled into view, in reading order: grouped by host
// so each host's queue moves them as one block and keeps that order.
export function prioritize(hrefs) {
	const byQueue = new Map();
	for (const key of hrefs.map(releaseKey)) {
		const queue = queueFor(key);
		byQueue.set(queue, [...(byQueue.get(queue) ?? []), key]);
	}
	for (const [queue, keys] of byQueue) {
		queue.prioritize(keys);
	}
}
