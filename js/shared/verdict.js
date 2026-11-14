// What a release page says about its price, and which URLs are release
// pages. Pure: no chrome.* or DOM APIs, so the service worker, the content
// script and the Node tests all share it.

const NAMED_ENTITIES = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" };

export function decodeEntities(text) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
		if (code[0] === "#") {
			const n =
				code[1] === "x" || code[1] === "X"
					? Number.parseInt(code.slice(2), 16)
					: Number.parseInt(code.slice(1), 10);
			return Number.isNaN(n) ? match : String.fromCodePoint(n);
		}
		return NAMED_ENTITIES[code.toLowerCase()] ?? match;
	});
}

// Every album and track page embeds its full sale data as JSON in a
// `data-tralbum` attribute on a <script> tag.
export function extractTralbum(html) {
	const match = html.match(/data-tralbum="([^"]*)"/);
	if (!match) {
		return null;
	}
	try {
		return JSON.parse(decodeEntities(match[1]));
	} catch {
		return null;
	}
}

/**
 * @typedef {object} Verdict
 * @property {"free" | "partial" | "paid" | "unknown"} kind
 * @property {"nyp" | "free"} [mode] how a free release is offered:
 *   "nyp" = name your price with a 0 minimum, "free" = plain free download
 * @property {boolean} [email] the free download asks for an email address
 * @property {number} [freeTracks] tracks downloadable for free on a paid album
 * @property {number} [totalTracks]
 */

/** @returns {Verdict} */
export function verdictFromTralbum(tralbum) {
	const current = tralbum?.current;
	if (!current) {
		return { kind: "unknown" };
	}

	const tracks = Array.isArray(tralbum.trackinfo) ? tralbum.trackinfo : [];
	const totalTracks = tracks.length;

	// minimum_price is null for releases that are not sold as downloads
	// (streaming only, physical only), so only an explicit 0 means free. Tracks
	// can also have downloads switched off (streaming only, pre-order) while
	// the price still reads 0: those are not free to download either.
	const downloadable =
		tracks.length === 0 || tracks.some((t) => t?.is_downloadable !== false);
	if (current.minimum_price === 0 && downloadable) {
		return {
			kind: "free",
			mode: current.set_price === 0 ? "free" : "nyp",
			email: Boolean(current.require_email),
			totalTracks,
		};
	}

	const freeTracks = tracks.filter((t) => t?.has_free_download).length;
	if (freeTracks > 0) {
		return { kind: "partial", freeTracks, totalTracks };
	}

	return { kind: "paid", totalTracks };
}

/** @returns {Verdict} */
export function verdictFromHtml(html) {
	const tralbum = extractTralbum(html);
	return tralbum ? verdictFromTralbum(tralbum) : { kind: "unknown" };
}

// Grid links carry tracking params (?label=…&tab=…); the release is the path.
export function releaseKey(href) {
	const url = new URL(href);
	return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

// Album or track page path, whatever the host: the content script uses it to
// pick release tiles, including ones on an artist's own domain, which the
// worker then answers "unknown" for.
export function isReleasePath(pathname) {
	return /\/(album|track)\/[^/]+\/?$/.test(pathname);
}

// The service worker only fetches Bandcamp release pages over https: the URL
// comes from the page's DOM, so it must not be able to point anywhere else.
export function isReleaseUrl(href) {
	try {
		const url = new URL(href);
		return (
			url.protocol === "https:" &&
			(url.hostname === "bandcamp.com" ||
				url.hostname.endsWith(".bandcamp.com")) &&
			isReleasePath(url.pathname)
		);
	} catch {
		return false;
	}
}
