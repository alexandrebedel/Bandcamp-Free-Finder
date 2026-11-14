// Downloads a release page, gently: one release gets a time budget across
// retries, a 429 pauses every request, and only the part of the page that
// holds the sale data is read.

const MAX_RETRIES = 3;
// A long Retry-After would hold a slot with no extension activity, long
// enough for Chrome to stop the worker and drop every queued request.
const MAX_RETRY_WAIT_S = 10;
// A stalled response would hold its slot forever and freeze the queue, so
// each attempt times out, and one release gets a total budget across retries.
const FETCH_TIMEOUT_MS = 20_000;
const RELEASE_BUDGET_MS = 45_000;

const TRALBUM_ATTR = 'data-tralbum="';

// Once Bandcamp answers 429, no request goes out before this time: the
// others would only collect more 429s and extend the ban.
let pausedUntil = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
	const deadline = Date.now() + RELEASE_BUDGET_MS;
	for (let attempt = 0; ; attempt++) {
		const pause = pausedUntil - Date.now();
		if (pause > 0) {
			if (Date.now() + pause >= deadline) {
				throw new Error(`Rate limited, gave up on ${url}`);
			}
			await sleep(pause);
		}
		const res = await fetch(url, {
			credentials: "omit",
			signal: AbortSignal.timeout(
				Math.max(1, Math.min(FETCH_TIMEOUT_MS, deadline - Date.now())),
			),
		});
		if (res.ok) {
			return readUntilSaleData(res.body);
		}
		res.body?.cancel().catch(() => {});
		if (res.status !== 429 || attempt >= MAX_RETRIES) {
			throw new Error(`HTTP ${res.status} for ${url}`);
		}
		const retryAfter = Number(res.headers.get("retry-after"));
		const waitMs =
			Math.min(retryAfter || 2 ** attempt * 2, MAX_RETRY_WAIT_S) * 1000;
		pausedUntil = Math.max(pausedUntil, Date.now() + waitMs);
	}
}
