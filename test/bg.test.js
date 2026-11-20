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

test("a count for a tab that just closed is dropped quietly", async () => {
	// Once the tab is gone, Chrome rejects every call on its icon.
	const { action } = globalThis.chrome;
	const saved = { ...action };
	const called = [];
	for (const name of Object.keys(saved)) {
		action[name] = async () => {
			called.push(name);
			throw new Error("No tab with id: 1.");
		};
	}
	const unhandled = [];
	const onUnhandled = (reason) => unhandled.push(reason);
	process.on("unhandledRejection", onUnhandled);
	let calledBeforeAnswer;
	try {
		const answer = await new Promise((resolve) => {
			listener({ type: "bff:count", count: 3 }, { tab: { id: 1 } }, (a) => {
				calledBeforeAnswer = called.length;
				resolve(a);
			});
		});
		assert.equal(answer, null);
		// Node reports unhandled rejections before the next timer runs.
		await new Promise((resolve) => setTimeout(resolve, 0));
	} finally {
		process.off("unhandledRejection", onUnhandled);
		Object.assign(action, saved);
	}
	// The calls go out together, and the answer doesn't wait for them.
	assert.equal(calledBeforeAnswer, Object.keys(saved).length);
	assert.deepEqual(unhandled, []);
});

test("a cached verdict is answered without fetching", async () => {
	await ask({ type: "bff:verdict", url: url("cached") });
	fetched.length = 0;
	const verdict = await ask({ type: "bff:verdict", url: url("cached") });
	assert.equal(verdict.kind, "free");
	assert.deepEqual(fetched, []);
});

const on = (host, name) => `https://${host}.bandcamp.com/album/${name}`;
const since = (t0, u) => fetchedAt.find(([v]) => v === u)[1] - t0;

test("a burst of 12 goes out at once, then requests are spaced", async () => {
	fetchedAt.length = 0;
	const t0 = Date.now();
	const urls = Array.from({ length: 13 }, (_, i) => on("burst", `b${i}`));
	await Promise.all(urls.map((u) => ask({ type: "bff:verdict", url: u })));
	assert.ok(since(t0, urls[11]) < 150, "12th sent within the burst");
	assert.ok(since(t0, urls[12]) >= 200, "13th waited for a token");
});

test("a 429 pauses that host only, and in-flight 429s count once", async () => {
	fetchedAt.length = 0;
	rateLimitOnce.add(on("paused", "p1"));
	rateLimitOnce.add(on("paused", "p2"));
	const t0 = Date.now();
	const paused = ["p1", "p2", "p3"].map((n) =>
		ask({ type: "bff:verdict", url: on("paused", n) }),
	);
	// Give p1 and p2 time to come back 429 before the other host asks.
	await new Promise((resolve) => setTimeout(resolve, 50));
	const other = await ask({ type: "bff:verdict", url: on("calm", "c1") });
	assert.equal(other.kind, "free");
	assert.ok(since(t0, on("calm", "c1")) < 300, "other host not held up");

	const verdicts = await Promise.all(paused);
	assert.ok(verdicts.every((v) => v.kind === "free"));
	// p1 and p2 were in flight together: one 2 s pause, not 2 s then 4 s.
	const retries = fetchedAt
		.filter(([u]) => u.includes("paused.bandcamp.com"))
		.slice(3)
		.map(([, t]) => t - t0);
	assert.ok(retries.length >= 2);
	assert.ok(retries[0] >= 1900, `retry at ${retries[0]} ms, after the pause`);
	assert.ok(
		retries[0] < 3500,
		`retry at ${retries[0]} ms, not a doubled pause`,
	);
});
