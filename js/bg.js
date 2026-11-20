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

async function answerVerdict(url, urgent, sendResponse) {
	let verdict;
	try {
		verdict = await getVerdict(url, urgent);
	} catch (err) {
		console.warn("[free-download-finder-for-bandcamp]", err);
		verdict = { kind: "unknown" };
	}
	sendResponse(verdict);
}

// Stays a plain function: returning true keeps the channel open until
// sendResponse is called.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg?.type === "bff:verdict") {
		if (!isReleaseUrl(msg.url)) {
			// e.g. a label grid linking to an artist's custom domain.
			sendResponse({ kind: "unknown" });
			return false;
		}
		answerVerdict(msg.url, Boolean(msg.urgent), sendResponse);
		return true;
	}

	if (msg?.type === "bff:prioritize" && Array.isArray(msg.urls)) {
		prioritize(msg.urls.filter(isReleaseUrl));
	}

	if (msg?.type === "bff:count" && sender.tab?.id !== undefined) {
		// Not awaited: the answer doesn't wait for the icon.
		showFreeCount(sender.tab.id, msg.count);
	}

	// Answer every message so the sender's promise never rejects on a closed port.
	sendResponse(null);
	return false;
});
