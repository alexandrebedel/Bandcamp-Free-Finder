// What the extension does on a label or artist page: scan the grid, put a
// band on free covers, list them above the grid, and count them on the
// toolbar icon. Loaded by js/content.js.

import { addBand, verdictCopy } from "./band.js";
import { createFreeList } from "./free-list.js";
import { send } from "./messages.js";
import { scanGrid } from "./scan.js";
import { findGrid, releaseId } from "./tiles.js";

const grid = findGrid();

if (grid) {
	const freeList = createFreeList(grid);
	// Counted and listed by release, not by tile.
	const listed = new Set();
	const free = new Set();
	let found = 0;
	let checked = 0;

	scanGrid(grid, {
		onStart() {
			found++;
			freeList.progress(checked, found);
		},

		onResult(tile, url, verdict) {
			checked++;
			freeList.progress(checked, found);
			const art = tile.querySelector(".art");

			if (verdict.kind === "unknown") {
				// Not the same as paid: the release may well be free.
				art.title = "Couldn't check this release: open it to see the price";
				return;
			}
			if (verdict.kind !== "free" && verdict.kind !== "partial") {
				return;
			}

			addBand(art, verdict);
			const release = releaseId(url);
			if (verdict.kind === "free" && !free.has(release)) {
				free.add(release);
				send({ type: "bff:count", count: free.size });
			}
			if (!listed.has(release)) {
				listed.add(release);
				freeList.add(tile, url, verdict, verdictCopy(verdict).detail);
			}
		},
	});
}
