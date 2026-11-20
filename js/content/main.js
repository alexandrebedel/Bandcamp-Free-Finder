// What the extension does on a label or artist page: scan the grid, put a
// band on free covers, list them above the grid, and count them on the
// toolbar icon. Loaded by js/content.js.

import { addBand, verdictCopy } from "./band.js";
import { createFreeList } from "./free-list.js";
import { send } from "./messages.js";
import { scanGrid } from "./scan.js";
import { findGrid, gridSize, releaseId } from "./tiles.js";

// Up to this many releases, the whole grid is checked right away; above it,
// only what's on screen, plus everything on "Check all". Bandcamp limits
// requests per label, and a big label alone can hit that limit.
const CHECK_ALL_UP_TO = 100;
// No answer for this long while requests are out: Bandcamp is making us wait.
const STALL_MS = 8_000;

const grid = findGrid();

if (grid) {
	// Counted and listed by release, not by tile.
	const listed = new Set();
	const free = new Set();
	let found = 0;
	let started = 0;
	let checked = 0;
	let waiting = false;
	let stallTimer;
	// Progress is held back until the grid's size has decided whether it's
	// all checked: otherwise a small label would briefly look half-checked
	// and show its strip with nothing free in it.
	let ready = false;

	const freeList = createFreeList(grid, {
		onCheckAll: () => scanner.checkAll(),
	});

	function update() {
		if (ready) {
			freeList.progress({ found, started, checked, waiting });
		}
	}

	function watchForStall() {
		clearTimeout(stallTimer);
		if (started > checked) {
			stallTimer = setTimeout(() => {
				waiting = true;
				update();
			}, STALL_MS);
		}
	}

	const scanner = scanGrid(grid, {
		onFound(count) {
			found += count;
			update();
		},

		onStart() {
			started++;
			if (started - checked === 1) {
				watchForStall();
			}
			update();
		},

		onResult(tile, url, verdict) {
			checked++;
			waiting = false;
			watchForStall();
			update();
			const art = tile.querySelector(".art");
			if (!art) {
				// Bandcamp re-rendered the tile while its verdict was pending.
				return;
			}

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

	// Decided on the grid's full size, not just the tiles rendered so far.
	if (gridSize(grid) <= CHECK_ALL_UP_TO) {
		scanner.checkAll();
	}
	ready = true;
	update();
}
