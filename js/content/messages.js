// Talking to the service worker (see js/bg.js for the message types).
//
// When the extension is reloaded or updated, this copy of the script is
// orphaned: sendMessage then throws, synchronously, instead of rejecting.
// Everything registered with onOrphaned stops at that point.

const orphanHandlers = [];
let alive = true;

export function onOrphaned(handler) {
	orphanHandlers.push(handler);
}

export async function send(message) {
	if (!alive) {
		return null;
	}
	try {
		return await chrome.runtime.sendMessage(message);
	} catch (err) {
		if (String(err).includes("context invalidated")) {
			alive = false;
			for (const handler of orphanHandlers) {
				handler();
			}
		}
		return null;
	}
}
