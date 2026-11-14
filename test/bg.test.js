import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The service worker, run against a fake chrome API and a fake network.

const salePage = readFileSync(
	new URL("fixtures/nyp-album.html", import.meta.url),
	"utf8",
);
const FILLER = "<p>rest of the page</p>".repeat(10_000); // ~230 KB

const store = {};
let listener;
globalThis.chrome = {
	storage: {
		local: {
			get: async (k) => (k === null ? { ...store } : { [k]: store[k] }),
			set: async (o) => Object.assign(store, o),
			remove: async () => {},
		},
	},
	runtime: {
		onInstalled: { addListener() {} },
		onStartup: { addListener() {} },
		onMessage: {
			addListener(f) {
				listener = f;
			},
		},
	},
	action: {
		setBadgeText() {},
		setBadgeBackgroundColor() {},
		setBadgeTextColor() {},
		setTitle() {},
	},
};

// Each fetch answers after a short delay with the page in 16 KB chunks,
// and records which URLs were requested, when, and how many chunks were
// pulled. URLs in `rateLimitOnce` get one 429 (Retry-After: 1) first.
const fetched = [];
const fetchedAt = [];
const rateLimitOnce = new Set();
let chunksPulled = 0;
let totalChunks = 0;
globalThis.fetch = async (url) => {
	fetched.push(url);
	fetchedAt.push([url, Date.now()]);
	await new Promise((resolve) => setTimeout(resolve, 5));
	if (rateLimitOnce.delete(url)) {
		return new Response(null, { status: 429, headers: { "retry-after": "1" } });
	}
	const bytes = new TextEncoder().encode(salePage + FILLER);
	const chunks = [];
	for (let i = 0; i < bytes.length; i += 16_384) {
		chunks.push(bytes.slice(i, i + 16_384));
	}
	totalChunks += chunks.length;
	const body = new ReadableStream({
		pull(controller) {
			const chunk = chunks.shift();
			if (chunk) {
				chunksPulled++;
				controller.enqueue(chunk);
			} else {
				controller.close();
			}
		},
	});
	return new Response(body, { status: 200 });
};

await import("../js/bg.js");

const ask = (msg) =>
	new Promise((resolve) => {
		listener(msg, { tab: { id: 1 } }, resolve);
	});
const url = (name) => `https://label.bandcamp.com/album/${name}?tab=music`;
const path = (u) => new URL(u).pathname.split("/").pop();

test("reads the page only until the sale data, and parses it", async () => {
	const before = { pulled: chunksPulled, total: totalChunks };
	const verdict = await ask({ type: "bff:verdict", url: url("partial-read") });
	assert.equal(verdict.kind, "free");
	const pulled = chunksPulled - before.pulled;
	const total = totalChunks - before.total;
	assert.ok(pulled <= 2, `pulled ${pulled} of ${total} chunks`);
});

test("an urgent cover goes ahead of the off-screen ones still waiting", async () => {
	fetched.length = 0;
	const names = ["n1", "n2", "n3", "n4", "n5", "n6"];
	const all = names.map((n) => ask({ type: "bff:verdict", url: url(n) }));
	all.push(ask({ type: "bff:verdict", url: url("u"), urgent: true }));
	await Promise.all(all);
	// n1-n3 took the 3 slots first; the urgent one runs right after.
	assert.deepEqual(fetched.map(path), [
		"n1",
		"n2",
		"n3",
		"u",
		"n4",
		"n5",
		"n6",
	]);
});

test("covers scrolled into view jump the queue in reading order", async () => {
	fetched.length = 0;
	const names = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
	const all = names.map((n) => ask({ type: "bff:verdict", url: url(n) }));
	// Let the requests reach the queue (the worker reads its cache first).
	await new Promise((resolve) => setTimeout(resolve, 0));
	await ask({ type: "bff:prioritize", urls: [url("a6"), url("a7")] });
	await Promise.all(all);
	assert.deepEqual(fetched.map(path), [
		"a1",
		"a2",
		"a3",
		"a6",
		"a7",
		"a4",
		"a5",
	]);
});

test("prioritize ignores anything that isn't a Bandcamp release", async () => {
	const answer = await ask({
		type: "bff:prioritize",
		urls: ["http://127.0.0.1/album/x", 42, null],
	});
	assert.equal(answer, null);
});

test("a cached verdict is answered without fetching", async () => {
	await ask({ type: "bff:verdict", url: url("cached") });
	fetched.length = 0;
	const verdict = await ask({ type: "bff:verdict", url: url("cached") });
	assert.equal(verdict.kind, "free");
	assert.deepEqual(fetched, []);
});

// Last: it leaves the worker paused for a second.
test("a 429 pauses every slot, not just the one that got it", async () => {
	fetchedAt.length = 0;
	rateLimitOnce.add("https://label.bandcamp.com/album/r1");
	const t0 = Date.now();
	const names = ["r1", "r2", "r3", "r4", "r5"];
	const verdicts = await Promise.all(
		names.map((n) => ask({ type: "bff:verdict", url: url(n) })),
	);
	assert.ok(verdicts.every((v) => v.kind === "free"));
	const at = fetchedAt.map(
		([u, t]) => `${path(u)}@${t - t0 < 900 ? "now" : "later"}`,
	);
	// r2 and r3 were already in flight when r1's 429 came back; r4, r5 and
	// r1's retry all waited for the pause to end.
	assert.deepEqual(at.sort(), [
		"r1@later",
		"r1@now",
		"r2@now",
		"r3@now",
		"r4@later",
		"r5@later",
	]);
});
