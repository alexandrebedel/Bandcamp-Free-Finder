import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
