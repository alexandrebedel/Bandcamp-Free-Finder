# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the repo owner, digging for music on Bandcamp. They browse label and artist pages (`/` and `/music`) and want to know which releases can be downloaded for free without opening each one. Personal use only: loaded unpacked in Chrome, not published to the Chrome Web Store.

## Product Purpose

A Chrome extension (Manifest V3) that checks every release tile on a Bandcamp label or artist grid in the background and marks the covers of free releases with a band. Success means the owner can scan a label's whole catalogue and see the free releases at a glance, without clicking on anything.

## Positioning

Bandcamp only shows the price on each release's own page. The extension reads each release's embedded sale data (`data-tralbum`) and moves that answer onto the grid.

## Operating Context

- Runs on `*.bandcamp.com` pages, on top of Bandcamp's own UI. Label pages have arbitrary custom theme colours and backgrounds, and covers can be any image.
- Grid tiles are `li.music-grid-item > a > .art > img`, square covers of 168 px at a 1024 px wide window. Bandcamp renders the first tiles server-side and appends the rest while scrolling.
- Covers on screen are checked first (a few seconds); the rest of a large label follows, three requests at a time, cached for 24 hours.
- It must stay light: no work on pages without a grid, no request bursts after a 429, animation only on covers on screen.

## Capabilities and Constraints

- Verdicts: **free** (`minimum_price` is 0, which Bandcamp shows as "name your price"; may require an email), **partial** (paid release with some individually free tracks), **paid**, **unknown** (page could not be read).
- Paid releases are left exactly as Bandcamp shows them: the extension adds to free tiles and does not dim, hide or restyle anything else (owner's decision).
- The toolbar icon shows the number of free releases on the current tab.
- Custom-domain label sites (not on `*.bandcamp.com`) are not covered.

## Brand Commitments

- On-cover copy is in English, using Bandcamp's own vocabulary ("free", "name your price"), as the owner chose.

## Product Principles

1. The answer lives on the cover: no clicks, no popups needed to know what is free.
2. Respect the host page: add only to free tiles; never hide or restyle Bandcamp's own content.
3. Be gentle with Bandcamp: throttle, cache, back off on 429.
