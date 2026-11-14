// Content-script entry. Content scripts can't be ES modules, so this one
// loads the real code, js/content/main.js, with a dynamic import. Those files
// are listed in the manifest's web_accessible_resources for that reason.
import(chrome.runtime.getURL("js/content/main.js")).catch((err) => {
	console.warn("[free-download-finder-for-bandcamp]", err);
});
