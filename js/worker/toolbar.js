// The count on the toolbar icon, per tab, in the band's sticker colours.

export function showFreeCount(tabId, count) {
	chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
	chrome.action.setBadgeBackgroundColor({ tabId, color: "#3ee07f" });
	chrome.action.setBadgeTextColor({ tabId, color: "#04150b" });
	chrome.action.setTitle({
		tabId,
		title:
			count > 0
				? `${count} free release${count > 1 ? "s" : ""} on this page`
				: "Free Download Finder for Bandcamp",
	});
}
