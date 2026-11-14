import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verdictCopy } from "../js/content/band.js";
import {
	insertionIndex,
	statusText,
	summaryText,
} from "../js/content/free-list.js";
import { gridSize } from "../js/content/tiles.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the free list keeps page order whatever order releases arrive in", () => {
	// Arrival order as the worker answers: on-screen covers first, then the
	// ones bumped while scrolling, then the rest.
	const arrivals = [10, 5, 3, 12, 7, 1, 11];
	const list = [];
	const before = (a, b) => a < b;
	for (const n of arrivals) {
		list.splice(insertionIndex(list, n, before), 0, n);
	}
	assert.deepEqual(list, [1, 3, 5, 7, 10, 11, 12]);
});

test("band copy", () => {
	assert.deepEqual(verdictCopy({ kind: "free", mode: "nyp", email: false }), {
		detail: "name your price",
		full: "Name your price: you can enter 0",
	});
	assert.equal(
		verdictCopy({ kind: "free", mode: "nyp", email: true }).detail,
		"with email",
	);
	assert.equal(verdictCopy({ kind: "free", mode: "free" }).detail, "");
	assert.deepEqual(
		verdictCopy({ kind: "partial", freeTracks: 1, totalTracks: 1 }),
		{
			detail: "1 of 1 track",
			short: "1/1",
			full: "1 of 1 tracks can be downloaded for free",
		},
	);
});

// js/content.js imports the content modules at runtime from extension URLs,
// which only works for files listed in web_accessible_resources. A module
// left out breaks the whole content script, silently.
test("every content module is web-accessible", () => {
	const manifest = JSON.parse(
		readFileSync(join(root, "manifest.json"), "utf8"),
	);
	const globs = manifest.web_accessible_resources.flatMap((r) => r.resources);
	const accessible = (path) =>
		globs.some((glob) =>
			new RegExp(
				`^${glob.replaceAll(".", "\\.").replaceAll("*", "[^/]*")}$`,
			).test(path),
		);

	const seen = new Set();
	const visit = (path) => {
		if (seen.has(path)) {
			return;
		}
		seen.add(path);
		const source = readFileSync(join(root, path), "utf8");
		for (const [, spec] of source.matchAll(/^import [^"]*"([^"]+)";$/gm)) {
			visit(relative(root, join(root, dirname(path), spec)));
		}
	};
	visit("js/content/main.js");

	const entry = readFileSync(join(root, "js/content.js"), "utf8");
	assert.ok(entry.includes('"js/content/main.js"'));
	assert.ok(seen.size >= 6, `found ${seen.size} modules`);
	for (const path of seen) {
		assert.ok(accessible(path), `${path} is not in web_accessible_resources`);
	}
});

test("free list wording", () => {
	assert.equal(
		summaryText({ free: 8, partial: 1, unchecked: 0 }),
		"8 releases · 1 with free tracks",
	);
	assert.equal(summaryText({ free: 1, partial: 0, unchecked: 3 }), "1 release");
	assert.equal(
		summaryText({ free: 0, partial: 0, unchecked: 360 }),
		"none found yet",
	);
	assert.equal(
		summaryText({ free: 0, partial: 0, unchecked: 0 }),
		"none on this page",
	);
	assert.equal(
		statusText({ found: 400, checked: 40, waiting: false }),
		"40 of 400 checked",
	);
	assert.equal(
		statusText({ found: 400, checked: 40, waiting: true }),
		"waiting for Bandcamp · 40 of 400 checked",
	);
	assert.equal(statusText({ found: 79, checked: 79, waiting: false }), "");
});

test("grid size counts the tiles Bandcamp hasn't rendered yet", () => {
	const grid = (tiles, clientItems) => ({
		querySelectorAll: () => ({ length: tiles }),
		dataset: clientItems === undefined ? {} : { clientItems },
	});
	// artsrecordings at load: 16 tiles, 399 more in data-client-items.
	const items = JSON.stringify(
		Array.from({ length: 399 }, (_, i) => ({ id: i })),
	);
	assert.equal(gridSize(grid(16, items)), 415);
	assert.equal(gridSize(grid(79)), 79);
	assert.equal(gridSize(grid(10, "not json")), 10);
});
