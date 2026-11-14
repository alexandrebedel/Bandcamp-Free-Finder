import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { verdictCopy } from "../js/content/band.js";
import { insertionIndex } from "../js/content/free-list.js";

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
