import assert from "node:assert/strict";
import { test } from "node:test";

// js/content/main.js, run on a fake label page with three covers on screen
// and a fake service worker that answers when the test says so.

const url = (name) => `https://label.bandcamp.com/album/${name}`;

function fakeArt() {
	const classes = new Set();
	const appended = [];
	return {
		classes,
		appended,
		classList: { add: (name) => classes.add(name) },
		append: (node) => appended.push(node),
	};
}

// Elements the extension creates: the bands and the free list.
const created = [];
function fakeElement() {
	const node = {
		classList: { add() {}, toggle() {} },
		style: { setProperty() {} },
		setAttribute() {},
		addEventListener() {},
		append() {},
		insertBefore() {},
	};
	created.push(node);
	return node;
}

function fakeTile(name) {
	const link = { href: url(name) };
	const tile = {
		art: fakeArt(),
		dataset: {},
		classList: { add() {} },
		getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
		compareDocumentPosition: (other) =>
			tiles.indexOf(other) > tiles.indexOf(tile)
				? Node.DOCUMENT_POSITION_FOLLOWING
				: Node.DOCUMENT_POSITION_PRECEDING,
		querySelector(selector) {
			if (selector === "a[href]") {
				return link;
			}
			return selector === ".art" ? tile.art : null;
		},
	};
	return tile;
}

const tiles = [fakeTile("not-checked"), fakeTile("gone"), fakeTile("redrawn")];
const grid = { dataset: {}, querySelectorAll: () => tiles, before() {} };

globalThis.document = {
	getElementById: (id) => (id === "music-grid" ? grid : null),
	querySelector: () => null,
	createElement: fakeElement,
};
globalThis.window = { innerHeight: 800 };
globalThis.Node = {
	ELEMENT_NODE: 1,
	DOCUMENT_POSITION_PRECEDING: 2,
	DOCUMENT_POSITION_FOLLOWING: 4,
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.MutationObserver = class {
	observe() {}
	disconnect() {}
};
// The free list's redraw isn't under test.
globalThis.requestAnimationFrame = () => {};

// Verdict requests wait in `pending` until the test answers them; the
// other messages land in `told`.
const pending = new Map();
const told = [];
globalThis.chrome = {
	runtime: {
		sendMessage: async (message) => {
			if (message.type === "bff:verdict") {
				return new Promise((resolve) => pending.set(message.url, resolve));
			}
			told.push(message);
			return null;
		},
	},
};

test("covers Bandcamp redraws while their verdicts are pending still count", async () => {
	const unhandled = [];
	const onUnhandled = (reason) => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	const [notChecked, gone, redrawn] = tiles;
	try {
		await import("../js/content/main.js");
		assert.deepEqual(
			[...pending.keys()],
			["not-checked", "gone", "redrawn"].map(url),
		);

		notChecked.art = null;
		gone.art = null;
		redrawn.art = fakeArt();
		pending.get(url("not-checked"))({ kind: "unknown" });
		pending.get(url("gone"))({ kind: "free", mode: "free" });
		pending.get(url("redrawn"))({ kind: "free", mode: "nyp" });
		// Node reports unhandled rejections before the next timer runs.
		await new Promise((resolve) => setTimeout(resolve, 0));
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
	assert.deepEqual(unhandled, []);

	// The new cover is styled and banded like the one it replaced.
	assert.ok(redrawn.art.classes.has("bff-art"));
	assert.deepEqual(
		redrawn.art.appended.map((node) => node.className),
		["bff-badge bff-badge--free"],
	);
	// Both free releases are counted and listed, cover or not.
	assert.deepEqual(told, [
		{ type: "bff:count", count: 1 },
		{ type: "bff:count", count: 2 },
	]);
	const listed = created.filter((node) =>
		node.className?.startsWith("bff-list__item "),
	);
	assert.equal(listed.length, 2);
});
