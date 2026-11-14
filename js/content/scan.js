// Checks every release tile of a grid with the service worker: the ones on
// screen first, then the rest in page order, then the tiles Bandcamp
// appends while scrolling. A pending tile that scrolls into view jumps the
// queue. Tile state lives in data-bff (pending, free, partial, paid,
// unknown), which the CSS reads.

import { onOrphaned, send } from "./messages.js";
import { isNearViewport, NEAR_PX, releaseUrl, TILE_SELECTOR } from "./tiles.js";

// onStart(tile) when a tile is sent, onResult(tile, url, verdict) when it's
// answered.
export function scanGrid(grid, { onStart, onResult }) {
	const handled = new WeakSet();

	async function check(tile, urgent) {
		const url = releaseUrl(tile);
		const art = tile.querySelector(".art");
		if (!url || !art || handled.has(tile)) {
			return;
		}
		handled.add(tile);
		art.classList.add("bff-art");
		tile.dataset.bff = "pending";
		if (urgent) {
			// Only covers on screen animate their scan line.
			tile.classList.add("bff-near");
		} else {
			onScreen.observe(tile);
		}
		onStart(tile);

		const verdict = (await send({ type: "bff:verdict", url, urgent })) ?? {
			kind: "unknown",
		};
		onScreen.unobserve(tile);
		tile.dataset.bff = verdict.kind;
		onResult(tile, url, verdict);
	}

	function checkTiles(tiles) {
		const fresh = tiles.filter((tile) => !handled.has(tile));
		// Read every position before the first DOM write, so the page lays out
		// once per batch instead of once per tile.
		const near = fresh.map(isNearViewport);
		const order = fresh.map((_, i) => i).sort((a, b) => near[b] - near[a]);
		for (const i of order) {
			check(fresh[i], near[i]);
		}
	}

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
		if (added.length > 0) {
			checkTiles(added);
		}
	});

	// Pending tiles that scroll into view go to the front, in reading order.
	const onScreen = new IntersectionObserver(
		(entries) => {
			const tiles = entries
				.filter((e) => e.isIntersecting && e.target.dataset.bff === "pending")
				.map((e) => e.target)
				.sort((a, b) =>
					a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
						? -1
						: 1,
				);
			for (const tile of tiles) {
				onScreen.unobserve(tile);
				tile.classList.add("bff-near");
			}
			const urls = tiles.map(releaseUrl).filter(Boolean);
			if (urls.length > 0) {
				send({ type: "bff:prioritize", urls });
			}
		},
		{ rootMargin: `${NEAR_PX}px 0px` },
	);

	onOrphaned(() => {
		appended.disconnect();
		onScreen.disconnect();
	});

	checkTiles([...grid.querySelectorAll(TILE_SELECTOR)]);
	appended.observe(grid, { childList: true, subtree: true });
}
