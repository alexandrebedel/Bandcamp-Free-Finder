import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const zipName = "free-download-finder-for-bandcamp.zip";

// `npm run zip` in a copy of the repo, so the test leaves the real zip alone.
// The copy gets the .DS_Store files a Mac leaves around, to check they stay out.
let dir;
let entries;
let manifest;

before(() => {
	dir = mkdtempSync(join(tmpdir(), "zip-"));
	for (const path of ["package.json", "manifest.json", "js", "css", "icons"]) {
		cpSync(join(root, path), join(dir, path), {
			recursive: true,
			filter: (src) => !src.endsWith(".DS_Store"),
		});
	}
	for (const path of [".DS_Store", "js/.DS_Store", "icons/.DS_Store"]) {
		writeFileSync(join(dir, path), "");
	}
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)),
	);
	execFileSync("npm", ["run", "--silent", "zip"], { cwd: dir, env });
	entries = execFileSync("unzip", ["-Z1", join(dir, zipName)], {
		encoding: "utf8",
	})
		.split("\n")
		.filter((entry) => entry && !entry.endsWith("/"));
	manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
});

after(() => dir && rmSync(dir, { recursive: true, force: true }));

function filesUnder(path) {
	return readdirSync(join(root, path), { recursive: true, withFileTypes: true })
		.filter((d) => d.isFile() && d.name !== ".DS_Store")
		.map((d) => posix.join(posix.relative(root, d.parentPath), d.name));
}

test("the zip holds the manifest, js, css and the PNG icons, nothing else", () => {
	const expected = [
		"manifest.json",
		...filesUnder("js"),
		...filesUnder("css"),
		...readdirSync(join(root, "icons"))
			.filter((f) => f.endsWith(".png"))
			.map((f) => `icons/${f}`),
	];
	assert.deepEqual([...entries].sort(), expected.sort());
	assert.ok(!entries.some((e) => e.endsWith(".DS_Store")));
	assert.ok(!entries.some((e) => e.startsWith("icons/src/")));
});

test("every file the manifest names is in the zip", () => {
	const named = [
		...Object.values(manifest.icons),
		...Object.values(manifest.action.default_icon),
		manifest.background.service_worker,
		...manifest.content_scripts.flatMap((s) => [...s.js, ...s.css]),
	];
	for (const path of named) assert.ok(entries.includes(path), path);
	for (const glob of manifest.web_accessible_resources.flatMap(
		(r) => r.resources,
	)) {
		const pattern = new RegExp(
			`^${glob.replace(/\./g, "\\.").replace(/\*/g, "[^/]*")}$`,
		);
		assert.ok(
			entries.some((e) => pattern.test(e)),
			`${glob} matches nothing`,
		);
	}
});

test("every module the zipped scripts load is in the zip", () => {
	for (const entry of entries.filter((e) => e.endsWith(".js"))) {
		const source = readFileSync(join(dir, entry), "utf8");
		const relative = [...source.matchAll(/from "(\.[^"]+)"/g)].map((m) =>
			posix.join(posix.dirname(entry), m[1]),
		);
		const fromRoot = [...source.matchAll(/getURL\("([^"]+)"\)/g)].map(
			(m) => m[1],
		);
		for (const path of [...relative, ...fromRoot]) {
			assert.ok(entries.includes(path), `${entry} loads ${path}`);
		}
	}
});

test("the zipped manifest is the repo's", () => {
	const zipped = execFileSync(
		"unzip",
		["-p", join(dir, zipName), "manifest.json"],
		{
			encoding: "utf8",
		},
	);
	assert.equal(zipped, readFileSync(join(root, "manifest.json"), "utf8"));
});
