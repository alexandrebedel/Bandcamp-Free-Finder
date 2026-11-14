import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(
	readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);

// Width and height from a PNG's IHDR chunk.
function pngSize(path) {
	const png = readFileSync(new URL(`../${path}`, import.meta.url));
	return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

test("every icon the manifest lists exists at its declared size", () => {
	const declared = [
		...Object.entries(manifest.icons),
		...Object.entries(manifest.action.default_icon),
	];
	assert.ok(manifest.icons["128"], "the stores need a 128 px icon");
	for (const [size, path] of declared) {
		assert.deepEqual(pngSize(path), [Number(size), Number(size)], path);
	}
});

test("store listing limits", () => {
	assert.ok(manifest.name.length <= 75, "Chrome Web Store: name up to 75");
	assert.ok(
		manifest.description.length <= 132,
		"Chrome Web Store: description up to 132",
	);
});

// The Chrome Web Store takes 1280x800 (or 640x400) screenshots, as JPEG or
// 24-bit PNG without alpha.
test("store screenshots are 1280x800 PNGs without alpha", () => {
	const dir = new URL("../store/screenshots/", import.meta.url);
	const shots = existsSync(dir)
		? readdirSync(dir).filter((f) => f.endsWith(".png"))
		: [];
	for (const shot of shots) {
		const path = `store/screenshots/${shot}`;
		assert.deepEqual(pngSize(path), [1280, 800], shot);
		const png = readFileSync(new URL(`../${path}`, import.meta.url));
		assert.equal(png[24], 8, `${shot}: 8 bits per channel`);
		assert.equal(png[25], 2, `${shot}: RGB, no alpha`);
	}
});

test("every image the README shows exists", () => {
	const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
	const paths = [
		...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g),
		...readme.matchAll(/<img[^>]*src="([^"]+)"/g),
	]
		.map((m) => m[1])
		.filter((path) => !/^https?:/.test(path));
	assert.ok(paths.length >= 4, `found ${paths.length} images`);
	for (const path of paths) {
		assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
	}
});
