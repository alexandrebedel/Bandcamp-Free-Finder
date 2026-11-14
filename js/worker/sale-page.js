// Downloads a release page, gently: requests to a host are paced (see
// pace.js), each attempt times out, and only the part of the page that holds
// the sale data is read.

import { rateLimited, succeeded, waitTurn } from "./pace.js";

// 429s in a row before one release is given up as "unknown". The host's
// pause grows meanwhile, so this covers about a minute of being limited.
const MAX_RATE_LIMITED = 4;
// A stalled response would hold its slot forever and freeze the queue.
const FETCH_TIMEOUT_MS = 20_000;

const TRALBUM_ATTR = 'data-tralbum="';

// Reads a release page's body only until its sale data has arrived (the
// attribute ends about a fifth into a 250-320 KB page), then cancels the
// read. Returns everything read so far.
export async function readUntilSaleData(body) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let html = "";
	let from = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) {
				return html + decoder.decode();
			}
			html += decoder.decode(value, { stream: true });
			const start = html.indexOf(TRALBUM_ATTR, from);
			if (
				start !== -1 &&
				html.indexOf('"', start + TRALBUM_ATTR.length) !== -1
			) {
				return html;
			}
			// Resume the search where it left off, overlapping the attribute's
			// length in case it straddles two chunks.
			from =
				start !== -1 ? start : Math.max(0, html.length - TRALBUM_ATTR.length);
		}
	} finally {
		reader.cancel().catch(() => {});
	}
}

// Returns the start of the release page, up to the end of its sale data.
export async function fetchSaleHtml(url) {
	const host = new URL(url).host;
	for (let limited = 0; ; ) {
		await waitTurn(host);
		const res = await fetch(url, {
			credentials: "omit",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (res.ok) {
			succeeded(host);
			return readUntilSaleData(res.body);
		}
		res.body?.cancel().catch(() => {});
		if (res.status !== 429) {
			throw new Error(`HTTP ${res.status} for ${url}`);
		}
		rateLimited(host, Number(res.headers.get("retry-after")));
		limited++;
		if (limited >= MAX_RATE_LIMITED) {
			throw new Error(`Rate limited, gave up on ${url}`);
		}
	}
}
