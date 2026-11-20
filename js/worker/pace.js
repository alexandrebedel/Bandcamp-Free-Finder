// How fast the worker may hit each Bandcamp host. Bandcamp rate-limits per
// subdomain (a label and all the releases it hosts share one), so each host
// gets its own budget, and a 429 pauses that host only.
//
// The budget is a token bucket: a burst of 12 requests (a screenful of
// covers goes out at once), then one per `spacing`. After a 429 the host
// pauses (2 s, then twice as long with each new pause, up to 30 s), the
// spacing doubles, and the bucket empties, so requests resume one at a
// time and the first one finds out whether the limit is over. Successes
// bring the spacing back down.

const BURST = 12;
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
		state = {
			tokens: BURST,
			refilledAt: Date.now(),
			spacing: MIN_SPACING_MS,
			pausedUntil: 0,
			strikes: 0,
			// The turns given out so far, chained so they go first come, first
			// served (the worker's queue already put them in the right order).
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

function refill(state) {
	const now = Date.now();
	state.tokens = Math.min(
		BURST,
		state.tokens + (now - state.refilledAt) / state.spacing,
	);
	state.refilledAt = now;
}

async function takeTurn(state, previous) {
	await previous;
	for (;;) {
		const paused = state.pausedUntil - Date.now();
		if (paused > 0) {
			await nap(paused);
			continue;
		}
		refill(state);
		if (state.tokens >= 1) {
			state.tokens -= 1;
			return;
		}
		await nap((1 - state.tokens) * state.spacing);
	}
}

// Resolves when it's this caller's turn to send a request to `host`, in the
// order callers asked.
export function waitTurn(host) {
	const state = stateOf(host);
	// Joins the line right away, without waiting: the next caller lines up
	// behind this turn.
	const turn = takeTurn(state, state.line);
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
	const now = Date.now();
	const retryAfterMs = (retryAfterS || 0) * 1000;
	// Requests already in flight come back 429 together: one pause for them.
	if (now < state.pausedUntil) {
		state.pausedUntil = Math.max(state.pausedUntil, now + retryAfterMs);
		return;
	}
	state.strikes++;
	state.spacing = Math.min(MAX_SPACING_MS, state.spacing * 2);
	state.tokens = 0;
	state.refilledAt = now;
	const pause = Math.min(
		MAX_PAUSE_MS,
		Math.max(FIRST_PAUSE_MS * 2 ** (state.strikes - 1), retryAfterMs),
	);
	state.pausedUntil = now + pause;
}
