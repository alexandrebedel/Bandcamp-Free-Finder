// Reading Bandcamp's release grid: where it is, and what each tile shows.
// Grid tiles are li.music-grid-item > a > .art > img, with a p.title that
// holds the title and, when it differs from the page's, the artist.

import { isReleasePath } from "../shared/verdict.js";

export const TILE_SELECTOR = "li.music-grid-item";

// How far outside the window a cover still counts as "on screen".
export const NEAR_PX = 200;

// Label and artist pages (/, /music) have one; album, track and fan pages
// don't, and the extension leaves those alone.
export function findGrid() {
	return (
		document.getElementById("music-grid") ??
		document.querySelector(TILE_SELECTOR)?.parentElement ??
		null
	);
}

export function releaseUrl(tile) {
	const link = tile.querySelector("a[href]");
	if (!link) {
		return null;
	}
	try {
		return isReleasePath(new URL(link.href).pathname) ? link.href : null;
	} catch {
		return null;
	}
}

// One release can appear in two tiles; grid links also carry tracking params.
export function releaseId(url) {
	return url.split(/[?#]/)[0].replace(/\/$/, "");
}

export function isNearViewport(tile) {
	const rect = tile.getBoundingClientRect();
	return rect.bottom > -NEAR_PX && rect.top < window.innerHeight + NEAR_PX;
}

// The page's own name: the label, or the artist on an artist page.
function pageName() {
	return document.querySelector('meta[property="og:site_name"]')?.content ?? "";
}

// Title, artist and cover as the tile shows them. Covers further down are
// lazy-loaded: their real URL sits in data-original until then.
export function describeTile(tile) {
	const title = tile.querySelector(".title");
	const artistEl = title?.querySelector(".artist-override");
	const titleText = [...(title?.childNodes ?? [])]
		.filter((node) => node !== artistEl)
		.map((node) => node.textContent)
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	const img = tile.querySelector(".art img");
	const src = img?.dataset.original || img?.getAttribute("src") || "";
	return {
		title: titleText || "Untitled",
		artist: artistEl?.textContent.trim() || pageName(),
		cover: src.startsWith("http") ? src : "",
	};
}
