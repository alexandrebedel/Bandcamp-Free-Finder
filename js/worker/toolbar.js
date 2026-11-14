// The count on the toolbar icon, per tab. Chrome draws it over the icon's
// bottom right, right on the green band, so it takes the sleeve's colours
// (dark, green digits) to read as a sticker on the band, not merge into it.

export function showFreeCount(tabId, count) {
	chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
	chrome.action.setBadgeBackgroundColor({ tabId, color: "#0f1411" });
	chrome.action.setBadgeTextColor({ tabId, color: "#3ee07f" });
	chrome.action.setTitle({
		tabId,
		title:
			count > 0
				? `${count} free release${count > 1 ? "s" : ""} on this page`
				: "Free Download Finder for Bandcamp",
	});
}
