// Verdicts kept in chrome.storage.local, so a label revisited within a day
// costs no request.

// Bump when the verdict format or rules change, so stale entries are ignored.
const CACHE_PREFIX = "v1:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function readCache(key) {
	const cacheKey = CACHE_PREFIX + key;
	const { [cacheKey]: entry } = await chrome.storage.local.get(cacheKey);
	if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
		return entry.verdict;
	}
	return null;
}

export async function writeCache(key, verdict) {
	await chrome.storage.local.set({
		[CACHE_PREFIX + key]: { verdict, at: Date.now() },
	});
}

// Drops expired verdicts and those from older cache versions, and leaves
// any other key in storage alone.
export async function pruneCache() {
	const all = await chrome.storage.local.get(null);
	const stale = Object.entries(all)
		.filter(
			([k, v]) =>
				/^v\d+:/.test(k) &&
				(!k.startsWith(CACHE_PREFIX) ||
					Date.now() - (v?.at ?? 0) >= CACHE_TTL_MS),
		)
		.map(([k]) => k);
	if (stale.length > 0) {
		await chrome.storage.local.remove(stale);
	}
}
