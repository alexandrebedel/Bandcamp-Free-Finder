# Free Download Finder for Bandcamp

Spot free downloads and name-your-price releases on Bandcamp label and artist pages, without opening each album.

A Chrome extension (Manifest V3). Not affiliated with Bandcamp.

On `/` and `/music` pages, release tiles get checked in the background: the whole grid on labels of up to 100 releases, and on bigger ones only the covers you look at, plus everything once you click **Check the other N** (Bandcamp limits requests per label, and a big label alone can hit that limit). Free covers get a green band at the bottom:

| Band | Meaning |
| --- | --- |
| **FREE** · name your price | Minimum price is 0: enter 0 at checkout |
| **FREE** · with email | Free download, Bandcamp asks for an email address |
| **FREE** (dark band) · 2 of 5 tracks | Paid release, but some tracks are free on their own |

Above the grid, a strip lists the free releases of the page in page order as they're found, with how much of the grid is checked. Its **Free only** button hides the releases known to be paid (until you click it again). On a small label the strip only appears when there is at least one free release; on a big one it's there from the start, with **Check the other N**.

The toolbar icon shows how many free releases are on the current tab. Paid releases are left untouched unless you turn on **Free only**.

## How it works

Every album and track page embeds its sale data as JSON in a `data-tralbum` attribute. The service worker reads it from each release page (`current.minimum_price`, `current.require_email`, `trackinfo[].has_free_download`) and answers the content script, which draws the band and the list.

```
manifest.json
js/
  bg.js                 service worker entry: routes the content script's messages
  content.js            content script entry: imports js/content/main.js
  shared/verdict.js     what a release page says about its price; release URLs
  worker/
    verdicts.js         cache, then a queue per host; one read per release
    queue.js            a few at a time, on-screen covers first
    sale-page.js        reads a page up to its sale data; timeouts, retries
    pace.js             per-host budget (burst, then spaced), pauses after a 429
    cache.js            24 h cache in chrome.storage.local
    toolbar.js          the count on the toolbar icon
  content/
    main.js             wires the scan to the band, the list and the count
    scan.js             checks tiles: on screen, on scroll, or all of them
    tiles.js            reads Bandcamp's grid: tiles, URLs, titles, covers
    band.js             the band on a free cover
    free-list.js        the strip above the grid
    messages.js         messages to the worker; stops when orphaned
css/
  tokens.css            shared colours and easing
  band.css              the band and the scan line
  free-list.css         the strip and "Free only"
```

Content scripts can't be ES modules, so `js/content.js` loads `js/content/main.js` with a dynamic `import()`. That is why `js/content/` and `js/shared/` are listed in the manifest's `web_accessible_resources` (Bandcamp pages can see that these files exist; a test checks every imported module is listed).

To stay light and polite with Bandcamp:

- covers on screen are checked first; on a big label, a cover you scroll past is only checked once it stays on screen for 300 ms;
- each Bandcamp host gets its own queue and budget: a burst of 12 requests (a screenful), then 4 per second, 3 at a time;
- each page is read only up to its sale data (about a fifth of it), then the read stops;
- on HTTP 429 that host pauses, 2 s then twice as long each time up to 30 s, and resumes one request at a time; the strip says "waiting for Bandcamp";
- verdicts are cached for 24 hours in `chrome.storage.local`, so a label you revisit costs no requests;
- pages without a release grid (album, track, fan pages) are left alone, and only covers on screen animate.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → pick this folder
3. Open a label page, e.g. `https://<label>.bandcamp.com/music`

After changing the code, click the reload icon on the extension card, then reload the Bandcamp tab.

## Development

```bash
npm install
npm test        # verdict rules (node:test)
npm run lint    # Biome
npm run zip     # free-download-finder-for-bandcamp.zip
```

## Limits

- Only `*.bandcamp.com` pages: labels on a custom domain are not covered.
- Only the release grid (`li.music-grid-item`), not the discography sidebar or the recommendations.
