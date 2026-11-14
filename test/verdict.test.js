import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	decodeEntities,
	extractTralbum,
	isReleaseUrl,
	readUntilSaleData,
	releaseKey,
	verdictFromHtml,
	verdictFromTralbum,
} from "../js/verdict.js";

// A body that serves `text` in `size`-byte chunks and reports whether it
// was cancelled before the end.
function streamOf(text, size) {
	const bytes = new TextEncoder().encode(text);
	let offset = 0;
	const state = { cancelled: false };
	const body = new ReadableStream({
		pull(controller) {
			if (offset >= bytes.length) {
				controller.close();
				return;
			}
			controller.enqueue(bytes.slice(offset, offset + size));
			offset += size;
		},
		cancel() {
			state.cancelled = offset < bytes.length;
		},
	});
	return { body, state };
}

test("reading stops once the sale data attribute is closed", async () => {
	const page = `<head>${"x".repeat(100)}<script data-tralbum="{&quot;a&quot;:1}"></script>${"y".repeat(5000)}`;
	const { body, state } = streamOf(page, 64);
	const html = await readUntilSaleData(body);
	assert.ok(html.includes('data-tralbum="{&quot;a&quot;:1}"'));
	assert.ok(html.length < 400, `read ${html.length} chars`);
	assert.equal(state.cancelled, true);
});

test("finds the attribute when it straddles two chunks", async () => {
	for (let size = 1; size <= 20; size++) {
		const { body } = streamOf(
			'<p>hello</p><script data-tralbum="{}"></script>tail',
			size,
		);
		const html = await readUntilSaleData(body);
		assert.equal(extractTralbum(html) !== null, true, `chunk size ${size}`);
	}
});

test("a page without sale data is read to the end", async () => {
	const { body, state } = streamOf("<html>no data here</html>", 4);
	assert.equal(await readUntilSaleData(body), "<html>no data here</html>");
	assert.equal(state.cancelled, false);
});

test("multi-byte characters split across chunks decode intact", async () => {
	const { body } = streamOf('é—ü <script data-tralbum="{}">', 1);
	assert.ok((await readUntilSaleData(body)).startsWith("é—ü "));
});

// Shape of the data-tralbum attribute as Bandcamp serves it (HTML-escaped JSON).
function page(tralbum) {
	const attr = JSON.stringify(tralbum)
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;");
	return `<html><script data-tralbum="${attr}" data-embed="{}"></script></html>`;
}

const track = (extra = {}) => ({ title: "t", is_downloadable: true, ...extra });

test("decodes the entities Bandcamp uses in attributes", () => {
	assert.equal(
		decodeEntities("&quot;a&amp;b&#39;&#x27;&lt;&gt;&nbsp;"),
		"\"a&b''<>&nbsp;",
	);
});

test("name your price with a 0 minimum is free", () => {
	const v = verdictFromHtml(
		page({
			current: { minimum_price: 0, set_price: 9 },
			trackinfo: [track(), track()],
		}),
	);
	assert.deepEqual(v, {
		kind: "free",
		mode: "nyp",
		email: false,
		totalTracks: 2,
	});
});

test("free download that asks for an email", () => {
	const v = verdictFromTralbum({
		current: { minimum_price: 0, set_price: 9, require_email: 1 },
		trackinfo: [track()],
	});
	assert.equal(v.kind, "free");
	assert.equal(v.email, true);
});

test("price set to 0 is a plain free download", () => {
	const v = verdictFromTralbum({
		current: { minimum_price: 0, set_price: 0 },
		trackinfo: [],
	});
	assert.equal(v.mode, "free");
});

test("paid album with some free tracks is partial", () => {
	const v = verdictFromTralbum({
		current: { minimum_price: 5, set_price: 9 },
		trackinfo: [track({ has_free_download: true }), track(), track()],
	});
	assert.deepEqual(v, { kind: "partial", freeTracks: 1, totalTracks: 3 });
});

test("paid album", () => {
	const v = verdictFromTralbum({
		current: { minimum_price: 4.5 },
		trackinfo: [track()],
	});
	assert.equal(v.kind, "paid");
});

test("release not sold as a download is not free", () => {
	const v = verdictFromTralbum({
		current: { minimum_price: null },
		trackinfo: [],
	});
	assert.equal(v.kind, "paid");
});

test("0 minimum with downloads switched off is not free", () => {
	const v = verdictFromTralbum({
		current: { minimum_price: 0, set_price: 9 },
		trackinfo: [
			track({ is_downloadable: false }),
			track({ is_downloadable: false }),
		],
	});
	assert.equal(v.kind, "paid");
});

test("0 minimum stays free when Bandcamp omits is_downloadable", () => {
	const v = verdictFromTralbum({
		current: { minimum_price: 0, set_price: 9 },
		trackinfo: [{ title: "t" }],
	});
	assert.equal(v.kind, "free");
});

// Trimmed from real pages (freshtakerecords.bandcamp.com, 2026-11-13): the
// data-tralbum attribute exactly as Bandcamp escapes it.
for (const [file, expected] of [
	["nyp-album.html", { kind: "free", mode: "nyp", email: false }],
	["email-album.html", { kind: "free", mode: "nyp", email: true }],
	["paid-album.html", { kind: "paid" }],
]) {
	test(`real page: ${file}`, () => {
		const html = readFileSync(
			new URL(`fixtures/${file}`, import.meta.url),
			"utf8",
		);
		const v = verdictFromHtml(html);
		for (const [k, value] of Object.entries(expected)) {
			assert.equal(v[k], value, `${file}: ${k}`);
		}
	});
}

test("pages without sale data are unknown", () => {
	assert.equal(extractTralbum("<html></html>"), null);
	assert.deepEqual(verdictFromHtml("<html></html>"), { kind: "unknown" });
	assert.deepEqual(verdictFromHtml('<div data-tralbum="{broken"></div>'), {
		kind: "unknown",
	});
});

test("release keys drop the grid's tracking params", () => {
	assert.equal(
		releaseKey("https://artist.bandcamp.com/album/x?label=123&tab=music"),
		"https://artist.bandcamp.com/album/x",
	);
	assert.equal(
		releaseKey("https://a.bandcamp.com/track/y/"),
		"https://a.bandcamp.com/track/y",
	);
});

test("only album and track pages are releases", () => {
	assert.ok(isReleaseUrl("https://a.bandcamp.com/album/x"));
	assert.ok(isReleaseUrl("https://a.bandcamp.com/track/y?from=grid"));
	assert.ok(!isReleaseUrl("https://a.bandcamp.com/music"));
	assert.ok(!isReleaseUrl("https://a.bandcamp.com/merch/shirt"));
	assert.ok(!isReleaseUrl("not a url"));
});

test("only https Bandcamp hosts are fetched", () => {
	assert.ok(!isReleaseUrl("http://a.bandcamp.com/album/x"));
	assert.ok(!isReleaseUrl("http://127.0.0.1:8080/album/x"));
	assert.ok(!isReleaseUrl("https://a.bandcamp.com.evil.example/album/x"));
	assert.ok(!isReleaseUrl("https://evilbandcamp.com/album/x"));
	assert.ok(!isReleaseUrl("https://music.custom-domain.example/album/x"));
});
