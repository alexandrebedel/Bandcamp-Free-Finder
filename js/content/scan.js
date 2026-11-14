// Checks release tiles with the service worker without hammering Bandcamp:
// the tiles on screen when the page opens, then the ones you stop on while
// scrolling, and every tile only when checkAll() is called. Tiles Bandcamp
// appends later go through the same rules. Tile state lives in data-bff
// (pending, free, partial, paid, unknown; none yet = not checked), which the
// CSS reads.

import { onOrphaned, send } from "./messages.js";
import { isNearViewport, NEAR_PX, releaseUrl, TILE_SELECTOR } from "./tiles.js";

// How long a tile has to stay on screen before it's checked, so scrolling
// fast through a 400-release label doesn't fire 400 requests.
const DWELL_MS = 300;

const inPageOrder = (a, b) =>
	a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;

// onFound(count) when tiles are seen, onStart(tile) when one is sent,
// onResult(tile, url, verdict) when it's answered.
export function scanGrid(grid, { onFound, onStart, onResult }) {
	const known = new WeakSet();
	const sent = new WeakSet();
	const tiles = [];
	const dwell = new Map();
	let checkingAll = false;

	async function check(tile, urgent) {
		if (sent.has(tile)) {
			return;
		}
		sent.add(tile);
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

	function add(candidates) {
		const fresh = candidates.filter(
			(tile) =>
				!known.has(tile) && releaseUrl(tile) && tile.querySelector(".art"),
		);
		if (fresh.length === 0) {
			return;
		}
		// Read every position before the first DOM write, so the page lays out
		// once per batch instead of once per tile.
		const near = fresh.map(isNearViewport);
		for (const tile of fresh) {
			known.add(tile);
			tile.querySelector(".art").classList.add("bff-art");
		}
		tiles.push(...fresh);
		onFound(fresh.length);

		// On screen first, then the rest: checked now when checking all,
		// otherwise watched until they come into view.
		fresh.forEach((tile, i) => near[i] && check(tile, true));
		fresh.forEach((tile, i) => {
			if (!near[i]) {
				if (checkingAll) {
					check(tile, false);
				}
				watch.observe(tile);
			}
		});
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
					const timer = setTimeout(() => {
						dwell.delete(tile);
						check(tile, true);
					}, DWELL_MS);
					dwell.set(tile, timer);
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
	});

	add([...grid.querySelectorAll(TILE_SELECTOR)]);
	appended.observe(grid, { childList: true, subtree: true });

	return {
		// Every tile not checked yet, in page order, behind the on-screen ones.
		checkAll() {
			checkingAll = true;
			for (const tile of tiles) {
				if (!sent.has(tile)) {
					clearTimeout(dwell.get(tile));
					dwell.delete(tile);
					check(tile, false);
				}
			}
		},
	};
}
