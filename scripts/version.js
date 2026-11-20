// Keeps the version of manifest.json and package.json together.
//   node scripts/version.js check [tag]   both files agree (and match the tag)
//   node scripts/version.js preflight     `npm version` hook: releases come from master
//   node scripts/version.js sync          `npm version` hook: package.json's version into manifest.json
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// Chrome takes one to four dot-separated integers from 0 to 65535, without
// leading zeros, and not all zero.
// https://developer.chrome.com/docs/extensions/reference/manifest/version
export function isChromeVersion(version) {
	if (typeof version !== "string") return false;
	const parts = version.split(".");
	return (
		parts.length <= 4 &&
		parts.every((p) => /^(0|[1-9]\d*)$/.test(p) && Number(p) <= 65535) &&
		parts.some((p) => p !== "0")
	);
}

// Negative, zero or positive, like a sort comparator. 1.2 and 1.2.0 are equal.
export function compareVersions(a, b) {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	for (let i = 0; i < 4; i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d) return Math.sign(d);
	}
	return 0;
}

// What stops these versions from shipping; empty when nothing does.
export function versionProblems({ manifest, pkg, tag }) {
	const problems = [];
	if (!isChromeVersion(manifest)) {
		problems.push(
			`manifest.json: "${manifest}" isn't a version Chrome takes (one to four numbers from 0 to 65535, like 1.2.0)`,
		);
	}
	if (pkg !== manifest) {
		problems.push(`package.json says ${pkg}, manifest.json says ${manifest}`);
	}
	if (tag !== undefined && tag !== `v${manifest}`) {
		problems.push(
			`the tag is ${tag}, but manifest.json's version needs the tag v${manifest}`,
		);
	}
	return problems;
}

// The manifest's text with a new version, and every other byte as it was.
export function setManifestVersion(text, version) {
	const current = JSON.parse(text).version;
	const field = new RegExp(
		`"version"(\\s*):(\\s*)"${current.replace(/\./g, "\\.")}"`,
		"g",
	);
	const matches = text.match(field) ?? [];
	if (matches.length !== 1) {
		throw new Error(
			`manifest.json: expected one "version": "${current}", found ${matches.length}`,
		);
	}
	const updated = text.replace(field, `"version"$1:$2"${version}"`);
	if (JSON.parse(updated).version !== version) {
		throw new Error("manifest.json: the version didn't change");
	}
	return updated;
}

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

function fail(message) {
	console.error(message);
	process.exit(1);
}

function main([command, arg]) {
	if (command === "check") {
		const manifest = JSON.parse(read("manifest.json")).version;
		const pkg = JSON.parse(read("package.json")).version;
		const problems = versionProblems({ manifest, pkg, tag: arg || undefined });
		if (problems.length) fail(problems.join("\n"));
		console.log(`Version ${manifest}${arg ? `, tag ${arg}` : ""}: OK`);
	} else if (command === "preflight") {
		const git = (...args) =>
			execFileSync("git", args, {
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim();
		const branch = git("rev-parse", "--abbrev-ref", "HEAD");
		if (branch !== "master") {
			fail(`Releases come from master, and this is ${branch}.`);
		}
		let origin = true;
		try {
			git("remote", "get-url", "origin");
		} catch {
			origin = false;
		}
		if (origin) {
			try {
				git("fetch", "--quiet", "origin", "master");
			} catch {
				fail(
					"Couldn't fetch origin/master to check that master is up to date.",
				);
			}
			try {
				git("merge-base", "--is-ancestor", "origin/master", "HEAD");
			} catch {
				fail("master is behind origin/master: git pull, then release.");
			}
		}
	} else if (command === "sync") {
		const { version } = JSON.parse(read("package.json"));
		if (!isChromeVersion(version)) {
			fail(
				`Chrome doesn't take the version ${version} (one to four numbers, like 1.2.0).\n` +
					"Undo the bump with: git checkout -- package.json package-lock.json",
			);
		}
		writeFileSync(
			new URL("manifest.json", root),
			setManifestVersion(read("manifest.json"), version),
		);
		console.log(`manifest.json: ${version}`);
	} else {
		fail("Usage: node scripts/version.js check [tag] | preflight | sync");
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2));
}
