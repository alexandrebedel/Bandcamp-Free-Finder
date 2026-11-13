// Runs keyed async tasks a few at a time, in arrival order, with an urgent
// lane in front for covers the user is looking at, so they don't wait behind
// the whole grid. Within the lane, tasks keep reading order.

export function createQueue(maxConcurrent) {
	const urgent = [];
	const normal = [];
	let active = 0;

	function pump() {
		while (active < maxConcurrent && (urgent.length > 0 || normal.length > 0)) {
			const { task, resolve, reject } = urgent.shift() ?? normal.shift();
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

	function take(key) {
		for (const lane of [urgent, normal]) {
			const index = lane.findIndex((entry) => entry.key === key);
			if (index !== -1) {
				return lane.splice(index, 1)[0];
			}
		}
		return null;
	}

	return {
		add(key, task, { urgent: isUrgent = false } = {}) {
			return new Promise((resolve, reject) => {
				(isUrgent ? urgent : normal).push({ key, task, resolve, reject });
				pump();
			});
		},

		// Moves these waiting tasks to the very front, in the order given (the
		// covers that just scrolled into view). Running or unknown keys are
		// skipped. Returns how many moved.
		prioritize(keys) {
			const moved = keys.map(take).filter(Boolean);
			urgent.unshift(...moved);
			return moved.length;
		},
	};
}
