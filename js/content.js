(() => {
	// Release tiles on label and artist pages (/, /music). Bandcamp renders the
	// first batch server-side and appends the rest from `data-client-items`
	// while scrolling, so new tiles are picked up by the observer below.
	const TILE_SELECTOR = "li.music-grid-item";
	// Same path rule as isReleaseUrl in js/verdict.js, which also checks the
	// host; content scripts can't import modules.
	const RELEASE_PATH = /\/(album|track)\/[^/]+\/?$/;
	// How far outside the window a cover still counts as "on screen".
	const NEAR_PX = 200;

	const handled = new WeakSet();
	// Counted by release, not by tile: a release can show up in two tiles.
	const freeReleases = new Set();
	let alive = true;

	function goQuiet(err) {
		// The extension was reloaded or updated: this copy of the script is
		// orphaned and must stop.
		if (String(err).includes("context invalidated")) {
			alive = false;
			observer.disconnect();
			onScreen.disconnect();
		}
		return null;
	}

	async function send(message) {
		if (!alive) {
			return null;
		}
		try {
			// An orphaned script throws here synchronously instead of rejecting.
			return await chrome.runtime.sendMessage(message);
		} catch (err) {
			return goQuiet(err);
		}
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

	// `urgent`: the cover is on screen (or close), so the worker checks it
	// before the off-screen ones. The others are watched and bumped when they
	// scroll into view.
	async function check(tile, urgent) {
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
		if (!urgent) {
			onScreen.observe(tile);
		}

		const verdict = await send({ type: "bff:verdict", url, urgent });
		onScreen.unobserve(tile);
		const kind = verdict?.kind ?? "unknown";
		tile.dataset.bff = kind;

		if (kind === "unknown") {
			// Not the same as paid: the release may well be free.
			art.title = "Couldn't check this release: open it to see the price";
		}
		if (kind === "free" || kind === "partial") {
			renderBadge(art, verdict);
			const release = url.split(/[?#]/)[0].replace(/\/$/, "");
			if (kind === "free" && !freeReleases.has(release)) {
				freeReleases.add(release);
				send({ type: "bff:count", count: freeReleases.size });
			}
		}
	}

	function isNearViewport(rect) {
		return rect.bottom > -NEAR_PX && rect.top < window.innerHeight + NEAR_PX;
	}

	function scan(root) {
		const tiles = root.matches?.(TILE_SELECTOR) ? [root] : [];
		tiles.push(...(root.querySelectorAll?.(TILE_SELECTOR) ?? []));
		const fresh = tiles.filter((tile) => !handled.has(tile));
		// Read every position before the first DOM write, so the page lays out
		// once instead of once per tile.
		const urgent = fresh.map((tile) =>
			isNearViewport(tile.getBoundingClientRect()),
		);
		fresh.forEach((tile, i) => {
			check(tile, urgent[i]);
		});
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

	// Off-screen requests wait in page order, so on a big label the covers at
	// the bottom would wait for the whole grid. When pending covers scroll
	// into view, they jump the worker's queue, in reading order.
	const onScreen = new IntersectionObserver(
		(entries) => {
			const tiles = entries
				.filter((e) => e.isIntersecting && e.target.dataset.bff === "pending")
				.map((e) => e.target)
				.sort((a, b) =>
					a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
						? -1
						: 1,
				);
			const urls = [];
			for (const tile of tiles) {
				onScreen.unobserve(tile);
				const url = releaseUrl(tile);
				if (url) {
					urls.push(url);
				}
			}
			if (urls.length > 0) {
				send({ type: "bff:prioritize", urls });
			}
		},
		{ rootMargin: `${NEAR_PX}px 0px` },
	);

	scan(document);
	observer.observe(document.body, { childList: true, subtree: true });
})();
