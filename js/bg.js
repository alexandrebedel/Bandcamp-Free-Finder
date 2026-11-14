// Service worker entry: routes the content script's messages.
//   bff:verdict    { url, urgent }  -> the release's verdict
//   bff:prioritize { urls }         -> those pending covers go first
//   bff:count      { count }        -> the toolbar icon's free count

import { isReleaseUrl } from "./shared/verdict.js";
import { pruneCache } from "./worker/cache.js";
import { showFreeCount } from "./worker/toolbar.js";
import { getVerdict, prioritize } from "./worker/verdicts.js";

chrome.runtime.onInstalled.addListener(pruneCache);
chrome.runtime.onStartup.addListener(pruneCache);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type === "bff:verdict") {
		if (!isReleaseUrl(msg.url)) {
			// e.g. a label grid linking to an artist's custom domain.
			sendResponse({ kind: "unknown" });
			return false;
		}
		getVerdict(msg.url, Boolean(msg.urgent)).then(sendResponse, (err) => {
			console.warn("[bandcamp-free-finder]", err);
			sendResponse({ kind: "unknown" });
		});
		return true;
	}

	if (msg?.type === "bff:prioritize" && Array.isArray(msg.urls)) {
		prioritize(msg.urls.filter(isReleaseUrl));
	}

	if (msg?.type === "bff:count" && sender.tab?.id !== undefined) {
		showFreeCount(sender.tab.id, msg.count);
	}

	// Answer every message so the sender's promise never rejects on a closed port.
	sendResponse(null);
	return false;
});
