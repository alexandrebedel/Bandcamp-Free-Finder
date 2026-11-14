// The "free on this page" strip above the grid (styles: css/free-list.css).
// It lists the free releases found so far in page order, whatever order
// they're found in, shows how much of the grid is checked, and offers "Check
// the other N" (on big labels only what's on screen is checked by default)
// and a "Free only" view of the grid.

import { describeTile, inPageOrder } from "./tiles.js";

// Where `item` goes in `sorted` to keep it ordered: before the first entry
// it precedes.
export function insertionIndex(sorted, item, precedes) {
	const index = sorted.findIndex((other) => precedes(item, other));
	return index === -1 ? sorted.length : index;
}

const comesBefore = (a, b) => inPageOrder(a.tile, b.tile) < 0;

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
	const toggle = el("button", "bff-list__button", "Free only");
	toggle.type = "button";
	toggle.setAttribute("aria-pressed", "false");
	toggle.title = "Hide the releases known to be paid";
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

function checkAllButton(onCheckAll) {
	const button = el("button", "bff-list__button");
	button.type = "button";
	button.title =
		"Checks the rest of the grid at a pace Bandcamp accepts: a few minutes on a big label";
	button.addEventListener("click", onCheckAll);
	return button;
}

export function summaryText({ free, partial, unchecked }) {
	const parts = [];
	if (free > 0) {
		parts.push(`${free} release${free > 1 ? "s" : ""}`);
	}
	if (partial > 0) {
		parts.push(`${partial} with free tracks`);
	}
	if (parts.length > 0) {
		return parts.join(" · ");
	}
	return unchecked > 0 ? "none found yet" : "none on this page";
}

export function statusText({ found, checked, waiting }) {
	const parts = [];
	if (waiting) {
		parts.push("waiting for Bandcamp");
	}
	if (checked < found) {
		parts.push(`${checked} of ${found} checked`);
	}
	return parts.join(" · ");
}

// `onCheckAll` runs when "Check the other N" is clicked.
export function createFreeList(grid, { onCheckAll }) {
	// Kept in page order: { tile, li, kind }.
	const entries = [];
	let scan = { found: 0, started: 0, checked: 0, waiting: false };
	let strip = null;
	let summary;
	let status;
	let checkAll;
	let freeOnly;
	let bar;
	let row;
	let renderQueued = false;

	function build() {
		strip = el("section", "bff-list");
		strip.setAttribute("aria-label", "Free releases on this page");

		summary = el("span", "bff-list__summary");
		status = el("span", "bff-list__status");
		checkAll = checkAllButton(onCheckAll);
		freeOnly = freeOnlyToggle(grid);
		const actions = el("span", "bff-list__actions");
		actions.append(checkAll, freeOnly);

		const head = el("div", "bff-list__head");
		head.append(el("span", "bff-list__tag", "Free"), summary, status, actions);

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
		const { found, started, checked, waiting } = scan;
		const free = entries.filter((e) => e.kind === "free").length;
		const unsent = found - started;
		summary.textContent = summaryText({
			free,
			partial: entries.length - free,
			unchecked: found - checked,
		});
		status.textContent = statusText({ found, checked, waiting });

		checkAll.hidden = unsent === 0;
		checkAll.textContent = `Check the other ${unsent}`;
		freeOnly.hidden = entries.length === 0;
		row.hidden = entries.length === 0;

		const scanning = started > checked;
		strip.classList.toggle("bff-list--scanning", scanning);
		bar.style.setProperty(
			"--bff-progress",
			String(found > 0 ? checked / found : 1),
		);
		bar.setAttribute("aria-valuemax", String(found));
		bar.setAttribute("aria-valuenow", String(checked));
		bar.setAttribute("aria-hidden", String(!scanning));
	}

	// Verdicts can land by the dozen in one go (cached ones): draw once per
	// frame. The strip shows up with the first free release, or right away
	// when part of the grid is left unchecked, so "Check the other N" is
	// there to click.
	function scheduleRender() {
		if (!strip && entries.length === 0 && scan.found === scan.started) {
			return;
		}
		if (!strip) {
			build();
		}
		if (renderQueued) {
			return;
		}
		renderQueued = true;
		requestAnimationFrame(() => {
			renderQueued = false;
			render();
		});
	}

	return {
		progress(next) {
			scan = next;
			scheduleRender();
		},

		// A free release, or a paid one with free tracks.
		add(tile, url, verdict, detail) {
			const entry = {
				tile,
				kind: verdict.kind,
				li: item(url, verdict, detail, describeTile(tile)),
			};
			const at = insertionIndex(entries, entry, comesBefore);
			entries.splice(at, 0, entry);
			if (!strip) {
				build();
			}
			row.insertBefore(entry.li, entries[at + 1]?.li ?? null);
			scheduleRender();
		},
	};
}
