// The "free on this page" strip above a release grid. It appears with the
// first free release the scan finds, lists them in page order as they come,
// shows the scan's progress, and offers a "free only" view of the grid.
// Loaded before js/content.js, in the same isolated world.

globalThis.bffCreateFreeList = (grid) => {
	let strip = null;
	let summary;
	let status;
	let bar;
	let list;
	const entries = [];
	let free = 0;
	let partial = 0;
	let done = 0;
	let total = 0;

	function el(tag, className, text) {
		const node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		if (text !== undefined) {
			node.textContent = text;
		}
		return node;
	}

	function build() {
		strip = el("section", "bff-list");
		strip.setAttribute("aria-label", "Free releases on this page");

		const head = el("div", "bff-list__head");
		head.append(el("span", "bff-list__tag", "Free"));
		summary = el("span", "bff-list__summary");
		status = el("span", "bff-list__status");
		head.append(summary, status);

		const toggle = el("button", "bff-list__toggle", "Free only");
		toggle.type = "button";
		toggle.setAttribute("aria-pressed", "false");
		toggle.title = "Hide the releases that aren't free";
		toggle.addEventListener("click", () => {
			const on = toggle.getAttribute("aria-pressed") !== "true";
			toggle.setAttribute("aria-pressed", String(on));
			grid.classList.toggle("bff-free-only", on);
			// Covers further down load on scroll: the ones the filter just
			// brought up would stay blank until Bandcamp's loader runs again.
			window.dispatchEvent(new Event("scroll"));
		});
		head.append(toggle);

		list = el("ul", "bff-list__items");
		bar = el("span", "bff-list__progress");
		bar.setAttribute("role", "progressbar");
		bar.setAttribute("aria-label", "Releases checked");

		strip.append(head, list, bar);
		grid.before(strip);
	}

	function render() {
		const parts = [];
		if (free > 0) {
			parts.push(`${free} release${free > 1 ? "s" : ""}`);
		}
		if (partial > 0) {
			parts.push(`${partial} with free tracks`);
		}
		summary.textContent = parts.join(" · ");

		const scanning = done < total;
		strip.classList.toggle("bff-list--scanning", scanning);
		status.textContent = scanning ? `checking ${done} of ${total}` : "";
		bar.style.setProperty(
			"--bff-progress",
			String(total > 0 ? done / total : 1),
		);
		bar.setAttribute("aria-valuemin", "0");
		bar.setAttribute("aria-valuemax", String(total));
		bar.setAttribute("aria-valuenow", String(done));
	}

	// The page's own name: the label, or the artist on an artist page. Tiles
	// only name an artist when it differs from it.
	const pageName =
		document.querySelector('meta[property="og:site_name"]')?.content ?? "";

	// Title, artist and cover as the grid shows them. Covers further down are
	// lazy-loaded: their real URL is in data-original until then.
	function describe(tile) {
		const title = tile.querySelector(".title");
		const img = tile.querySelector(".art img");
		const src = img?.dataset.original || img?.getAttribute("src") || "";
		return {
			title: title?.firstChild?.textContent.trim() || "Untitled",
			artist:
				title?.querySelector(".artist-override")?.textContent.trim() ||
				pageName,
			cover: src.startsWith("http") ? src : "",
		};
	}

	function item(url, verdict, detail, { title, artist, cover }) {
		const li = el("li", `bff-list__item bff-list__item--${verdict.kind}`);
		const link = el("a", "bff-list__link");
		link.href = url;
		link.title = artist ? `${title} by ${artist}` : title;

		const art = el("span", "bff-list__art");
		if (cover) {
			const img = el("img");
			img.src = cover;
			img.alt = "";
			img.width = 96;
			img.height = 96;
			img.loading = "lazy";
			img.decoding = "async";
			art.append(img);
		}
		// Every line is always there, so titles, artists and details line up
		// across items.
		link.append(
			art,
			el("span", "bff-list__title", title),
			el("span", "bff-list__artist", artist || " "),
			el("span", "bff-list__detail", detail || "free download"),
		);
		li.append(link);
		return li;
	}

	return {
		progress(checked, found) {
			done = checked;
			total = found;
			if (strip) {
				render();
			}
		},

		// Adds a free or partial release, keeping the grid's order.
		add(tile, url, verdict, detail) {
			if (!strip) {
				build();
			}
			const li = item(url, verdict, detail, describe(tile));
			const next = entries.find(
				(entry) =>
					tile.compareDocumentPosition(entry.tile) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			);
			list.insertBefore(li, next ? next.li : null);
			entries.push({ tile, li });

			if (verdict.kind === "free") {
				free++;
			} else {
				partial++;
			}
			render();
		},
	};
};
