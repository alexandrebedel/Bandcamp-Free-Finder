function findAlbumsUrls() {
  const scope =
    document.querySelector(
      "#music-grid, .music-grid, .discography-grid, .grid, .merch-grid"
    ) || document;
  const links = Array.from(
    scope.querySelectorAll('a[href*="/album/"], a[href*="/track/"]')
  );

  return links.map((a) => a.href);
}

async function fetchDOM(url) {
  const res = await fetch(url);

  if (!res.ok) {
    return null;
  }

  const text = await res.text();
  const dom = new DOMParser();

  return dom.parseFromString(text, "text/html");
}

async function main() {
  const urls = findAlbumsUrls();
  const dom = await fetchDOM(urls[2]);

  getPurchaseVerdict(dom);
  debugger;
}

main();
