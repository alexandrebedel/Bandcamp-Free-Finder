# Bandcamp Free Finder

Chrome extension (Manifest V3) that marks the free releases on a Bandcamp label or artist page, without opening them.

On `/` and `/music` pages, every release tile gets checked in the background. Free covers get a green band at the bottom:

| Band | Meaning |
| --- | --- |
| **FREE** · name your price | Minimum price is 0: enter 0 at checkout |
| **FREE** · with email | Free download, Bandcamp asks for an email address |
| **FREE** (dark band) · 2 of 5 tracks | Paid release, but some tracks are free on their own |

The toolbar icon shows how many free releases are on the current tab. Paid releases are left untouched.

## How it works

Every album and track page embeds its sale data as JSON in a `data-tralbum` attribute. The service worker (`js/bg.js`) fetches each release page, reads `current.minimum_price`, `current.require_email` and `trackinfo[].has_free_download` (`js/verdict.js`), and sends the verdict to the content script (`js/content.js`), which draws the band (`css/badge.css`).

To stay light and polite with Bandcamp:

- covers on screen are checked first; the rest of the grid follows, 3 requests at a time;
- each page is read only up to its sale data (about a fifth of it), then the read stops;
- on HTTP 429 every request pauses, not just the one that got it;
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
npm run zip     # bandcamp-free-finder.zip
```

## Limits

- Only `*.bandcamp.com` pages: labels on a custom domain are not covered.
- Only the release grid (`li.music-grid-item`), not the discography sidebar or the recommendations.
