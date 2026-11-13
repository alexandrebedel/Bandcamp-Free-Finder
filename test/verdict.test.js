import assert from "node:assert/strict";
import { test } from "node:test";
import {
	decodeEntities,
	extractTralbum,
	isReleaseUrl,
	releaseKey,
	verdictFromHtml,
	verdictFromTralbum,
} from "../js/verdict.js";

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
