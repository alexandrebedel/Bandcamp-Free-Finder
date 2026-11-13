(() => {
	// Release tiles on label and artist pages (/, /music). Bandcamp renders the
	// first batch server-side and appends the rest from `data-client-items`
	// while scrolling, so new tiles are picked up by the observer below.
	const TILE_SELECTOR = "li.music-grid-item";
	const RELEASE_PATH = /\/(album|track)\/[^/]+\/?$/;

	const handled = new WeakSet();
	let freeCount = 0;
	let alive = true;

	function send(message) {
		if (!alive) {
			return Promise.resolve(null);
		}
		return chrome.runtime.sendMessage(message).catch((err) => {
			// The extension was reloaded or updated: this copy of the script is
			// orphaned and must go quiet.
			if (String(err).includes("context invalidated")) {
				alive = false;
				observer.disconnect();
			}
			return null;
		});
	}

	function releaseUrl(tile) {
		const link = tile.querySelector("a[href]");
		if (!link) {
			return null;
		}
		try {
			return RELEASE_PATH.test(new URL(link.href).pathname) ? link.href : null;
		} catch {
			return null;
		}
	}

	// Short line on the band; the full sentence goes in the tooltip.
	function copy(verdict) {
		if (verdict.kind === "partial") {
			const { freeTracks: n, totalTracks: total } = verdict;
			return {
				detail: `${n} of ${total} track${total > 1 ? "s" : ""}`,
				// Kept on small covers: a bare "FREE" would misstate a paid release.
				short: `${n}/${total}`,
				full: `${n} of ${total} tracks can be downloaded for free`,
			};
		}
		if (verdict.email) {
			return {
				detail: "with email",
				full: "Free download: Bandcamp asks for an email address",
			};
		}
		if (verdict.mode === "nyp") {
			return {
				detail: "name your price",
				full: "Name your price: you can enter 0",
			};
		}
		return { detail: "", full: "Free download" };
	}

	function renderBadge(art, verdict) {
		const main = "Free";
		const { detail, short, full } = copy(verdict);
		const badge = document.createElement("span");
		badge.className = `bff-badge bff-badge--${verdict.kind}`;
		badge.setAttribute("role", "note");
		badge.setAttribute("aria-label", full);
		badge.title = full;

		const mainEl = document.createElement("span");
		mainEl.className = "bff-badge__main";
		mainEl.textContent = main;
		badge.append(mainEl);

		if (detail) {
			const detailEl = document.createElement("span");
			detailEl.className = "bff-badge__detail";
			detailEl.textContent = detail;
			badge.append(detailEl);
		}
		if (short) {
			const shortEl = document.createElement("span");
			shortEl.className = "bff-badge__short";
			shortEl.textContent = short;
			badge.append(shortEl);
		}
		art.append(badge);
	}

	async function check(tile) {
		if (handled.has(tile)) {
			return;
		}
		const url = releaseUrl(tile);
		const art = tile.querySelector(".art");
		if (!url || !art) {
			return;
		}
		handled.add(tile);
		art.classList.add("bff-art");
		tile.dataset.bff = "pending";

		const verdict = await send({ type: "bff:verdict", url });
		const kind = verdict?.kind ?? "unknown";
		tile.dataset.bff = kind;

		if (kind === "unknown") {
			// Not the same as paid: the release may well be free.
			art.title = "Couldn't check this release: open it to see the price";
		}
		if (kind === "free" || kind === "partial") {
			renderBadge(art, verdict);
			if (kind === "free") {
				freeCount++;
				send({ type: "bff:count", count: freeCount });
			}
		}
	}

	function scan(root) {
		if (root.matches?.(TILE_SELECTOR)) {
			check(root);
		}
		for (const tile of root.querySelectorAll?.(TILE_SELECTOR) ?? []) {
			check(tile);
		}
	}

	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === Node.ELEMENT_NODE) {
					scan(node);
				}
			}
		}
	});

	scan(document);
	observer.observe(document.body, { childList: true, subtree: true });
})();
