# Chrome Web Store listing

What to paste in each field of the developer dashboard. The store fields
are plain text: copy the text inside the code blocks as it is.

## Store listing ("Fiche Store")

**Description**

```
See which releases you can download for free on any Bandcamp label or artist page, without opening each album.

Bandcamp only shows a release's price on its own page. Free Download Finder for Bandcamp checks the releases of the label or artist page you're on, in the background, and marks the free ones right on the grid.

WHAT YOU GET
• A green band on every free cover, saying how it's free: "name your price" (enter 0 at checkout), "with email" (Bandcamp asks for an email address), or "2 of 5 tracks" on paid releases that give some tracks away.
• A list of the page's free releases above the grid, in page order, with how much of the grid has been checked.
• "Free only": one click hides the releases known to be paid.
• The number of free releases on the toolbar icon.

LIGHT ON BANDCAMP
Labels of up to 100 releases are checked in full. On bigger ones, the extension checks the covers you look at, and "Check the other N" does the rest at a pace Bandcamp accepts. Answers are kept for 24 hours, so a label you come back to costs nothing. Album, track and fan pages are left alone.

PRIVATE
No account, no analytics, no tracking. The extension only reads Bandcamp release pages (without your cookies) and keeps its answers on your computer.

Works on *.bandcamp.com label and artist pages; labels on their own domain aren't covered.

Not affiliated with Bandcamp. Open source: https://github.com/alexandrebedel/free-download-finder-for-bandcamp
```

**Category**: Lifestyle > Shopping (or Lifestyle > Entertainment)

**Language**: English

**Store icon** (128x128): `icons/icon-128.png`

**Screenshots** (1280x800), in this order:
1. `store/screenshots/1-free-list.png`
2. `store/screenshots/2-bands-on-covers.png`
3. `store/screenshots/3-free-only.png`

**Small promo tile** (440x280): `store/promo/small-440x280.png`. Optional, but
listings without one are shown after those that have one.

**Marquee promo tile** (1400x560): `store/promo/marquee-1400x560.png`. Optional,
needed to be featured in the store's marquee. Its covers are abstract
stand-ins, not real releases.

Both are rendered from `store/promo/src/*.html` with `npm run promo`.

**Homepage URL**: https://github.com/alexandrebedel/free-download-finder-for-bandcamp

**Support URL**: https://github.com/alexandrebedel/free-download-finder-for-bandcamp/issues

## Privacy ("Pratiques de confidentialité")

**Single purpose**

```
Marks the free and name-your-price releases on Bandcamp label and artist pages, so users can find free downloads without opening each release.
```

**Permission justification: storage**

```
Caches, for 24 hours, whether each release is free, so revisiting a label doesn't fetch its release pages again. Nothing else is stored, and nothing leaves the user's computer.
```

**Permission justification: host permission (*://*.bandcamp.com/*)**

```
Reads Bandcamp release pages to find their price (the public sale data Bandcamp embeds in each album and track page), and shows the result on Bandcamp label and artist pages. Requests are sent without the user's cookies. No other site is accessed.
```

**Remote code**: No, I am not using remote code. (All the code ships in the
package; `js/content.js` imports the packaged `js/content/main.js`, which is
not remote code.)

**Data usage**: tick none of the data types: the extension collects no user
data. The three certifications at the bottom are yours to confirm.

**Privacy policy URL**: not required when no user data is collected. If the
form asks for one anyway:
https://github.com/alexandrebedel/free-download-finder-for-bandcamp#good-to-know

## Distribution ("Distribution")

- Payment: free
- Visibility: public
- Regions: all regions
