import assert from "node:assert/strict";
import { test } from "node:test";
import { createQueue } from "../js/queue.js";

// A task that records when it starts and finishes on the next tick.
function recorder() {
	const started = [];
	const task = (key) => async () => {
		started.push(key);
		await new Promise((resolve) => setImmediate(resolve));
		return key;
	};
	return { started, task };
}

test("runs tasks in arrival order, a few at a time", async () => {
	const q = createQueue(2);
	const { started, task } = recorder();
	const results = await Promise.all(
		["a", "b", "c", "d"].map((k) => q.add(k, task(k))),
	);
	assert.deepEqual(results, ["a", "b", "c", "d"]);
	assert.deepEqual(started, ["a", "b", "c", "d"]);
});

test("urgent tasks run before the others, in their own arrival order", async () => {
	const q = createQueue(1);
	const { started, task } = recorder();
	const all = [
		q.add("a", task("a")),
		q.add("b", task("b")),
		q.add("v1", task("v1"), { urgent: true }),
		q.add("c", task("c")),
		q.add("v2", task("v2"), { urgent: true }),
	];
	await Promise.all(all);
	// "a" was already running when the urgent ones arrived.
	assert.deepEqual(started, ["a", "v1", "v2", "b", "c"]);
});

test("prioritized tasks jump ahead as a block, keeping the given order", async () => {
	const q = createQueue(1);
	const { started, task } = recorder();
	const all = ["a", "b", "c", "d", "e"].map((k) => q.add(k, task(k)));
	assert.equal(q.prioritize(["d", "e"]), 2);
	await Promise.all(all);
	assert.deepEqual(started, ["a", "d", "e", "b", "c"]);
});

test("the latest prioritized block goes before earlier urgent tasks", async () => {
	const q = createQueue(1);
	const { started, task } = recorder();
	const all = [
		q.add("a", task("a")),
		q.add("v", task("v"), { urgent: true }),
		q.add("b", task("b")),
		q.add("c", task("c")),
	];
	q.prioritize(["c"]);
	await Promise.all(all);
	assert.deepEqual(started, ["a", "c", "v", "b"]);
});

test("running or unknown keys are skipped", async () => {
	const q = createQueue(1);
	const { started, task } = recorder();
	const all = ["a", "b"].map((k) => q.add(k, task(k)));
	assert.equal(q.prioritize(["a", "nope"]), 0);
	await Promise.all(all);
	assert.deepEqual(started, ["a", "b"]);
});

test("a failing task does not stall the queue", async () => {
	const q = createQueue(1);
	const failed = q.add("x", async () => {
		throw new Error("boom");
	});
	const next = q.add("y", async () => "ok");
	await assert.rejects(failed, /boom/);
	assert.equal(await next, "ok");
});
