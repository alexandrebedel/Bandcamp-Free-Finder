// The "free on this page" strip above the grid (styles: css/free-list.css).
// It appears with the first free release the scan finds, lists them in page
// order whatever order they're found in, shows the scan's progress, and
// offers a "Free only" view of the grid.

import { describeTile } from "./tiles.js";

// Where `item` goes in `sorted` to keep it ordered: before the first entry
// it precedes.
export function insertionIndex(sorted, item, precedes) {
	const index = sorted.findIndex((other) => precedes(item, other));
	return index === -1 ? sorted.length : index;
}

const comesBefore = (a, b) =>
	Boolean(
		a.tile.compareDocumentPosition(b.tile) & Node.DOCUMENT_POSITION_FOLLOWING,
	);

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

function freeOnlyToggle(grid) {
	const toggle = el("button", "bff-list__toggle", "Free only");
	toggle.type = "button";
	toggle.setAttribute("aria-pressed", "false");
	toggle.title = "Hide the releases that aren't free";
	toggle.addEventListener("click", () => {
		const on = toggle.getAttribute("aria-pressed") !== "true";
		toggle.setAttribute("aria-pressed", String(on));
		grid.classList.toggle("bff-free-only", on);
		// Covers further down load on scroll: the ones the filter just brought
		// up would stay blank until Bandcamp's loader runs again.
		window.dispatchEvent(new Event("scroll"));
	});
	return toggle;
}

// A vertical wheel scrolls the row sideways, until it reaches an end; from
// there the page scrolls as usual. Trackpads already scroll sideways.
function scrollSideways(row) {
	row.addEventListener(
		"wheel",
		(event) => {
			if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
				return;
			}
			const max = row.scrollWidth - row.clientWidth;
			const atStart = event.deltaY < 0 && row.scrollLeft <= 0;
			const atEnd = event.deltaY > 0 && row.scrollLeft >= max - 1;
			if (max <= 0 || atStart || atEnd) {
				return;
			}
			event.preventDefault();
			row.scrollLeft += event.deltaY;
		},
		{ passive: false },
	);
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
	// Every line is always there, so titles, artists and details line up.
	link.append(
		art,
		el("span", "bff-list__title", title),
		el("span", "bff-list__artist", artist || " "),
		el("span", "bff-list__detail", detail || "free download"),
	);
	li.append(link);
	return li;
}

export function createFreeList(grid) {
	// Kept in page order: { tile, li, kind }.
	const entries = [];
	let done = 0;
	let total = 0;
	let strip = null;
	let summary;
	let status;
	let bar;
	let row;
	let renderQueued = false;

	function build() {
		strip = el("section", "bff-list");
		strip.setAttribute("aria-label", "Free releases on this page");

		const head = el("div", "bff-list__head");
		summary = el("span", "bff-list__summary");
		status = el("span", "bff-list__status");
		head.append(
			el("span", "bff-list__tag", "Free"),
			summary,
			status,
			freeOnlyToggle(grid),
		);

		row = el("ul", "bff-list__items");
		scrollSideways(row);

		bar = el("span", "bff-list__progress");
		bar.setAttribute("role", "progressbar");
		bar.setAttribute("aria-label", "Releases checked");
		bar.setAttribute("aria-valuemin", "0");

		strip.append(head, row, bar);
		grid.before(strip);
	}

	function render() {
		const free = entries.filter((e) => e.kind === "free").length;
		const partial = entries.length - free;
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
		bar.setAttribute("aria-valuemax", String(total));
		bar.setAttribute("aria-valuenow", String(done));
		bar.setAttribute("aria-hidden", String(!scanning));
	}

	// Verdicts can land by the dozen in one go (cached ones): draw once per
	// frame.
	function scheduleRender() {
		if (!strip || renderQueued) {
			return;
		}
		renderQueued = true;
		requestAnimationFrame(() => {
			renderQueued = false;
			render();
		});
	}

	return {
		progress(checked, found) {
			done = checked;
			total = found;
			scheduleRender();
		},

		// A free release, or a paid one with free tracks.
		add(tile, url, verdict, detail) {
			if (!strip) {
				build();
			}
			const entry = {
				tile,
				kind: verdict.kind,
				li: item(url, verdict, detail, describeTile(tile)),
			};
			const at = insertionIndex(entries, entry, comesBefore);
			row.insertBefore(entry.li, entries[at]?.li ?? null);
			entries.splice(at, 0, entry);
			scheduleRender();
		},
	};
}
