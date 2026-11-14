// The green band across the foot of a free cover (styles: css/band.css).

// What the band and its tooltip say: a short detail for the band, a short
// count for small covers (a bare "FREE" would misstate a paid release with
// free tracks), and the full sentence.
export function verdictCopy(verdict) {
	if (verdict.kind === "partial") {
		const { freeTracks: n, totalTracks: total } = verdict;
		return {
			detail: `${n} of ${total} track${total > 1 ? "s" : ""}`,
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

function span(className, text) {
	const node = document.createElement("span");
	node.className = className;
	node.textContent = text;
	return node;
}

export function addBand(art, verdict) {
	const { detail, short, full } = verdictCopy(verdict);
	const band = span(`bff-badge bff-badge--${verdict.kind}`, "");
	band.setAttribute("role", "note");
	band.setAttribute("aria-label", full);
	band.title = full;
	band.append(span("bff-badge__main", "Free"));
	if (detail) {
		band.append(span("bff-badge__detail", detail));
	}
	if (short) {
		band.append(span("bff-badge__short", short));
	}
	art.append(band);
}
