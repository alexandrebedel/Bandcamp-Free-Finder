// Pure parsing helpers: no chrome.* or DOM APIs, so they run in the service
// worker and in Node tests alike.

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
	// (streaming only, physical only), so only an explicit 0 means free.
	if (current.minimum_price === 0) {
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

export function isReleaseUrl(href) {
	try {
		return /\/(album|track)\/[^/]+\/?$/.test(new URL(href).pathname);
	} catch {
		return false;
	}
}
