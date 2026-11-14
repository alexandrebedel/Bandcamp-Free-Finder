// How fast the worker may hit each Bandcamp host. Bandcamp rate-limits per
// subdomain (a label and all the releases it hosts share one), so requests
// to a host are spaced out, and a 429 pauses that host only.
//
// After a 429 the pause doubles with each one in a row (2, 4, 8, 16, then
// 30 s), and the spacing doubles too. Once the pause ends, requests resume
// one at a time, so a single request finds out whether the limit is over.
// Successes bring the spacing back down.

const MIN_SPACING_MS = 250;
const MAX_SPACING_MS = 4_000;
const FIRST_PAUSE_MS = 2_000;
const MAX_PAUSE_MS = 30_000;
// Chrome stops an idle worker after about 30 s; calling an extension API
// during a long wait keeps it running.
const KEEPALIVE_MS = 20_000;

const hosts = new Map();

function stateOf(host) {
	let state = hosts.get(host);
	if (!state) {
		// `line`: the turns given out so far, chained so they go first come,
		// first served (the worker's queue already put them in the right order).
		state = {
			nextAt: 0,
			spacing: MIN_SPACING_MS,
			strikes: 0,
			line: Promise.resolve(),
		};
		hosts.set(host, state);
	}
	return state;
}

async function nap(ms) {
	let left = ms;
	while (left > 0) {
		const step = Math.min(left, KEEPALIVE_MS);
		await new Promise((resolve) => setTimeout(resolve, step));
		left -= step;
		if (left > 0) {
			globalThis.chrome?.runtime?.getPlatformInfo?.();
		}
	}
}

// Resolves when it's this caller's turn to send a request to `host`, in the
// order callers asked.
export function waitTurn(host) {
	const state = stateOf(host);
	const turn = state.line.then(async () => {
		// Re-read after each nap: a 429 meanwhile pushes nextAt further.
		for (let wait = state.nextAt - Date.now(); wait > 0; ) {
			await nap(wait);
			wait = state.nextAt - Date.now();
		}
		state.nextAt = Date.now() + state.spacing;
	});
	state.line = turn;
	return turn;
}

export function succeeded(host) {
	const state = stateOf(host);
	state.strikes = 0;
	state.spacing = Math.max(MIN_SPACING_MS, Math.round(state.spacing * 0.9));
}

export function rateLimited(host, retryAfterS) {
	const state = stateOf(host);
	state.strikes++;
	state.spacing = Math.min(MAX_SPACING_MS, state.spacing * 2);
	const pause = Math.min(
		MAX_PAUSE_MS,
		Math.max(
			FIRST_PAUSE_MS * 2 ** (state.strikes - 1),
			(retryAfterS || 0) * 1000,
		),
	);
	state.nextAt = Math.max(state.nextAt, Date.now() + pause);
}
