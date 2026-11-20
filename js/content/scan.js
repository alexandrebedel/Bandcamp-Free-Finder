// Checks release tiles with the service worker without hammering Bandcamp:
// the tiles on screen when the page opens, then the ones you stop on while
// scrolling, and every tile only when checkAll() is called. Tile state lives
// in data-bff (pending, free, partial, paid, unknown; none yet = not
// checked), which the CSS reads.

import { onOrphaned, send } from "./messages.js";
import {
	inPageOrder,
	isNearViewport,
	NEAR_PX,
	releaseUrl,
	TILE_SELECTOR,
} from "./tiles.js";

// How long a tile has to stay on screen before it's checked, so scrolling
// fast through a 400-release label doesn't fire 400 requests.
const DWELL_MS = 300;
// Check all sends this many requests at a time and refills as answers come,
// so no request waits long in the worker (Chrome gives a message about five
// minutes to be answered).
const CHECK_ALL_WINDOW = 8;

// onFound(count) when tiles are seen, onStart(tile) when one is sent,
// onResult(tile, url, verdict) when it's answered.
export function scanGrid(grid, { onFound, onStart, onResult }) {
	const known = new WeakSet();
	const sent = new WeakSet();
	const tiles = [];
	const dwell = new Map();
	// Check all: the tiles still to send, in page order.
	const backlog = [];
	let checkingAll = false;
	let backlogInFlight = 0;

	async function check(tile, urgent) {
		if (sent.has(tile)) {
			return;
		}
		sent.add(tile);
		clearTimeout(dwell.get(tile));
		dwell.delete(tile);
		const url = releaseUrl(tile);
		tile.dataset.bff = "pending";
		if (urgent) {
			// Only covers on screen animate their scan line.
			tile.classList.add("bff-near");
		}
		onStart(tile);

		const verdict = (await send({ type: "bff:verdict", url, urgent })) ?? {
			kind: "unknown",
		};
		watch.unobserve(tile);
		tile.dataset.bff = verdict.kind;
		onResult(tile, url, verdict);
	}

	async function checkFromBacklog(tile) {
		try {
			await check(tile, false);
		} finally {
			backlogInFlight--;
			pumpBacklog();
		}
	}

	function pumpBacklog() {
		while (backlogInFlight < CHECK_ALL_WINDOW && backlog.length > 0) {
			const tile = backlog.shift();
			if (sent.has(tile)) {
				continue;
			}
			backlogInFlight++;
			// Not awaited: up to CHECK_ALL_WINDOW checks are out at once.
			checkFromBacklog(tile);
		}
	}

	// `initial`: tiles on screen when the page opens are checked at once;
	// anything else waits until it stays in view (or for Check all).
	function add(candidates, { initial = false } = {}) {
		const fresh = candidates.filter(
			(tile) =>
				!known.has(tile) && releaseUrl(tile) && tile.querySelector(".art"),
		);
		if (fresh.length === 0) {
			return;
		}
		// Read every position before the first DOM write, so the page lays out
		// once per batch instead of once per tile.
		const near = initial ? fresh.map(isNearViewport) : [];
		for (const tile of fresh) {
			known.add(tile);
			tile.querySelector(".art").classList.add("bff-art");
		}
		tiles.push(...fresh);
		onFound(fresh.length);

		fresh.forEach((tile, i) => {
			if (near[i]) {
				check(tile, true);
			} else {
				watch.observe(tile);
				if (checkingAll) {
					backlog.push(tile);
				}
			}
		});
		pumpBacklog();
	}

	// A tile in view: checked once it stays there for DWELL_MS, or, if it's
	// already waiting in the worker's queue, moved to the front.
	const watch = new IntersectionObserver(
		(entries) => {
			const bump = [];
			for (const { target: tile, isIntersecting } of entries) {
				if (!isIntersecting) {
					clearTimeout(dwell.get(tile));
					dwell.delete(tile);
				} else if (sent.has(tile)) {
					watch.unobserve(tile);
					tile.classList.add("bff-near");
					bump.push(tile);
				} else if (!dwell.has(tile)) {
					dwell.set(
						tile,
						setTimeout(() => check(tile, true), DWELL_MS),
					);
				}
			}
			const urls = bump.sort(inPageOrder).map(releaseUrl);
			if (urls.length > 0) {
				send({ type: "bff:prioritize", urls });
			}
		},
		{ rootMargin: `${NEAR_PX}px 0px` },
	);

	// Tiles Bandcamp appends, collected per batch of mutations.
	const appended = new MutationObserver((mutations) => {
		const added = [];
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					if (node.matches(TILE_SELECTOR)) {
						added.push(node);
					}
					added.push(...node.querySelectorAll(TILE_SELECTOR));
				}
			}
		}
		add(added);
	});

	onOrphaned(() => {
		appended.disconnect();
		watch.disconnect();
		for (const timer of dwell.values()) {
			clearTimeout(timer);
		}
		backlog.length = 0;
	});

	add([...grid.querySelectorAll(TILE_SELECTOR)], { initial: true });
	appended.observe(grid, { childList: true, subtree: true });

	return {
		// Every tile not checked yet, in page order, a few at a time, behind
		// the on-screen ones.
		checkAll() {
			checkingAll = true;
			backlog.push(...tiles.filter((tile) => !sent.has(tile)));
			pumpBacklog();
		},
	};
}
