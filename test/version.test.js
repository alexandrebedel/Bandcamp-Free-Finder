import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	compareVersions,
	isChromeVersion,
	setManifestVersion,
	versionProblems,
} from "../scripts/version.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestText = readFileSync(join(root, "manifest.json"), "utf8");
const current = JSON.parse(manifestText).version;

test("versions Chrome takes", () => {
	for (const v of ["1", "1.2", "1.2.0", "1.2.3.4", "0.0.1", "65535.0.0"]) {
		assert.ok(isChromeVersion(v), v);
	}
	for (const v of [
		"",
		"0",
		"0.0.0",
		"1.02.0",
		"1.2.3.4.5",
		"1.2.0-beta.1",
		"v1.2.0",
		"65536.0.0",
		"1..2",
		undefined,
	]) {
		assert.ok(!isChromeVersion(v), String(v));
	}
});

test("versions compare part by part, missing parts as zero", () => {
	assert.ok(compareVersions("1.2.0", "1.1.9") > 0);
	assert.ok(compareVersions("1.10.0", "1.9.0") > 0);
	assert.ok(compareVersions("1.1.0", "1.1.1") < 0);
	assert.equal(compareVersions("1.2", "1.2.0"), 0);
	assert.ok(compareVersions("1.2.0.1", "1.2.0") > 0);
});

test("a release ships when the tag, the manifest and package.json agree", () => {
	assert.deepEqual(
		versionProblems({ manifest: "1.2.0", pkg: "1.2.0", tag: "v1.2.0" }),
		[],
	);
	assert.deepEqual(versionProblems({ manifest: "1.2.0", pkg: "1.2.0" }), []);
});

test("a release stops on a tag that doesn't match the manifest", () => {
	for (const tag of ["v1.1.0", "1.2.0", "v1.2.0.0", ""]) {
		const problems = versionProblems({ manifest: "1.2.0", pkg: "1.2.0", tag });
		assert.equal(problems.length, 1, tag);
		assert.match(problems[0], /needs the tag v1\.2\.0/);
	}
});

test("a release stops when package.json and the manifest disagree", () => {
	const problems = versionProblems({
		manifest: "1.1.0",
		pkg: "1.2.0",
		tag: "v1.1.0",
	});
	assert.deepEqual(problems, [
		"package.json says 1.2.0, manifest.json says 1.1.0",
	]);
});

test("a release stops on a version Chrome doesn't take", () => {
	const problems = versionProblems({
		manifest: "1.2.0-beta.1",
		pkg: "1.2.0-beta.1",
		tag: "v1.2.0-beta.1",
	});
	assert.equal(problems.length, 1);
	assert.match(problems[0], /isn't a version Chrome takes/);
});

test("setting the manifest's version changes that line only", () => {
	const updated = setManifestVersion(manifestText, "9.8.7");
	assert.equal(JSON.parse(updated).version, "9.8.7");
	const before = manifestText.split("\n");
	const changed = updated.split("\n").filter((line, i) => line !== before[i]);
	assert.deepEqual(changed, ['\t"version": "9.8.7",']);
	assert.equal(
		JSON.parse(updated).manifest_version,
		JSON.parse(manifestText).manifest_version,
	);
});

test("setting the version refuses a manifest where it's ambiguous", () => {
	const twice = JSON.stringify({ version: "1.0.0", x: { version: "1.0.0" } });
	assert.throws(() => setManifestVersion(twice, "1.1.0"), /found 2/);
});

test("the check command passes on the matching tag and fails otherwise", () => {
	const check = (...args) =>
		spawnSync(
			process.execPath,
			[join(root, "scripts/version.js"), "check", ...args],
			{ encoding: "utf8" },
		);
	assert.equal(check(`v${current}`).status, 0);
	assert.equal(check().status, 0);
	const wrong = check("v0.0.1");
	assert.equal(wrong.status, 1);
	assert.match(wrong.stderr, new RegExp(`needs the tag v${current}`));
});

// `npm run release` for real, in a throwaway copy of the repo: package.json's
// lifecycle scripts, npm's own commit and tag, and the manifest hook.
const sandboxes = [];
after(() => {
	for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

const gitEnv = {
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.invalid",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.invalid",
};
// Without the npm_* variables of the `npm test` running this file.
const env = {
	...Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)),
	),
	...gitEnv,
};

function sandbox() {
	const dir = mkdtempSync(join(tmpdir(), "release-"));
	sandboxes.push(dir);
	mkdirSync(join(dir, "scripts"));
	for (const file of [
		"package.json",
		"package-lock.json",
		"manifest.json",
		"biome.json",
		"scripts/version.js",
	]) {
		copyFileSync(join(root, file), join(dir, file));
	}
	symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
	writeFileSync(join(dir, ".gitignore"), "node_modules\n");
	const git = (...args) =>
		execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
	git("init", "-q", "-b", "master");
	git("add", ".");
	git("commit", "-q", "-m", "Start");
	const run = (...args) =>
		spawnSync("npm", ["run", "release", "--", ...args], {
			cwd: dir,
			env,
			encoding: "utf8",
		});
	const version = (file) =>
		JSON.parse(readFileSync(join(dir, file), "utf8")).version;
	return { dir, git, run, version };
}

function next(version, part) {
	const [major, minor, patch] = version.split(".").map(Number);
	return part === "minor"
		? `${major}.${minor + 1}.0`
		: `${major}.${minor}.${patch + 1}`;
}

test("npm run release bumps both files, commits and tags", () => {
	const { dir, git, run, version } = sandbox();
	const result = run("minor");
	assert.equal(result.status, 0, result.stdout + result.stderr);

	const bumped = next(current, "minor");
	assert.equal(version("package.json"), bumped);
	assert.equal(version("manifest.json"), bumped);
	const lock = JSON.parse(readFileSync(join(dir, "package-lock.json"), "utf8"));
	assert.equal(lock.version, bumped);
	assert.equal(lock.packages[""].version, bumped);

	assert.equal(git("log", "-1", "--format=%s"), `Release ${bumped}`);
	assert.equal(
		git("rev-parse", `v${bumped}^{commit}`),
		git("rev-parse", "HEAD"),
	);
	assert.equal(git("cat-file", "-t", `v${bumped}`), "tag", "annotated tag");
	assert.equal(git("status", "--porcelain"), "", "nothing left uncommitted");
	assert.deepEqual(git("diff", "--name-only", "HEAD~1").split("\n").sort(), [
		"manifest.json",
		"package-lock.json",
		"package.json",
	]);
});

test("npm run release refuses a branch other than master", () => {
	const { git, run, version } = sandbox();
	git("switch", "-q", "-c", "feature");
	const result = run("patch");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Releases come from master, and this is feature/);
	assert.equal(version("package.json"), current);
	assert.equal(version("manifest.json"), current);
	assert.equal(git("tag"), "");
});

test("npm run release refuses a version Chrome doesn't take", () => {
	const { git, run, version } = sandbox();
	const result = run(`${next(current, "minor")}-beta.1`);
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Chrome doesn't take the version/);
	assert.equal(version("manifest.json"), current);
	assert.equal(git("log", "-1", "--format=%s"), "Start");
	assert.equal(git("tag"), "");
});
