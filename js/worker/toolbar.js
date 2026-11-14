// The count on the toolbar icon, per tab. Chrome draws it over the icon's
// bottom right, right on the green band, with no outline: in the band's green
// the two merge, and in the sleeve's dark it merges with the sleeve on a dark
// toolbar. The icon's light rim colour with ink digits stands apart from the
// band, the sleeve and both toolbar themes.

export function showFreeCount(tabId, count) {
	chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
	chrome.action.setBadgeBackgroundColor({ tabId, color: "#a9bfb1" });
	chrome.action.setBadgeTextColor({ tabId, color: "#04150b" });
	chrome.action.setTitle({
		tabId,
		title:
			count > 0
				? `${count} free release${count > 1 ? "s" : ""} on this page`
				: "Free Download Finder for Bandcamp",
	});
}
