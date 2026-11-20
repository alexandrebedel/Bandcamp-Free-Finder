import assert from "node:assert/strict";
import { test } from "node:test";

// js/content/main.js, run on a fake label page with two covers on screen
// and a fake service worker that answers when the test says so.

const url = (name) => `https://label.bandcamp.com/album/${name}`;

function fakeTile(name) {
	const link = { href: url(name) };
	let art = { classList: { add() {} } };
	return {
		dataset: {},
		classList: { add() {} },
		getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
		querySelector(selector) {
			if (selector === "a[href]") {
				return link;
			}
			return selector === ".art" ? art : null;
		},
		// What Bandcamp's re-render looks like from here.
		dropArt() {
			art = null;
		},
	};
}

const tiles = [fakeTile("not-checked"), fakeTile("free")];
const grid = { dataset: {}, querySelectorAll: () => tiles };

globalThis.document = {
	getElementById: (id) => (id === "music-grid" ? grid : null),
	createElement: () => ({ append() {}, setAttribute() {} }),
};
globalThis.window = { innerHeight: 800 };
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.MutationObserver = class {
	observe() {}
	disconnect() {}
};

// Verdict requests wait in `pending` until the test answers them.
const pending = new Map();
globalThis.chrome = {
	runtime: {
		sendMessage: async (message) =>
			message.type === "bff:verdict"
				? new Promise((resolve) => pending.set(message.url, resolve))
				: null,
	},
};

test("a cover Bandcamp re-renders while its verdict is pending is skipped", async () => {
	const unhandled = [];
	const onUnhandled = (reason) => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	try {
		await import("../js/content/main.js");
		assert.deepEqual([...pending.keys()], [url("not-checked"), url("free")]);

		for (const tile of tiles) {
			tile.dropArt();
		}
		pending.get(url("not-checked"))({ kind: "unknown" });
		pending.get(url("free"))({ kind: "free", mode: "free" });
		// Node reports unhandled rejections before the next timer runs.
		await new Promise((resolve) => setTimeout(resolve, 0));
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
	assert.deepEqual(
		tiles.map((tile) => tile.dataset.bff),
		["unknown", "free"],
	);
	assert.deepEqual(unhandled, []);
});
