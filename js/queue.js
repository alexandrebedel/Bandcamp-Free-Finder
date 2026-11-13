// Runs keyed async tasks a few at a time, in arrival order, with an urgent
// lane at the front for covers the user is looking at, so they don't wait
// behind the whole grid. Within the lane, tasks keep reading order.

export function createQueue(maxConcurrent) {
	// Urgent entries first, then the rest; each entry is { key, urgent, ... }.
	const waiting = [];
	let active = 0;

	function pump() {
		while (active < maxConcurrent && waiting.length > 0) {
			const { task, resolve, reject } = waiting.shift();
			active++;
			Promise.resolve()
				.then(task)
				.then(resolve, reject)
				.finally(() => {
					active--;
					pump();
				});
		}
	}

	function endOfUrgentLane() {
		const index = waiting.findIndex((entry) => !entry.urgent);
		return index === -1 ? waiting.length : index;
	}

	return {
		add(key, task, { urgent = false } = {}) {
			return new Promise((resolve, reject) => {
				const entry = { key, task, resolve, reject, urgent };
				waiting.splice(urgent ? endOfUrgentLane() : waiting.length, 0, entry);
				pump();
			});
		},

		// Moves these waiting tasks to the very front, in the order given (the
		// covers that just scrolled into view). Running or unknown keys are
		// skipped. Returns how many moved.
		prioritize(keys) {
			const moved = [];
			for (const key of keys) {
				const index = waiting.findIndex((entry) => entry.key === key);
				if (index !== -1) {
					const [entry] = waiting.splice(index, 1);
					entry.urgent = true;
					moved.push(entry);
				}
			}
			waiting.unshift(...moved);
			return moved.length;
		},
	};
}
