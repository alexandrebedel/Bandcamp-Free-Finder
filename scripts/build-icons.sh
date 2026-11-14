#!/bin/sh
# Renders icons/src/icon-<size>.svg to icons/icon-<size>.png with headless
# Chrome, on a transparent background, at exactly <size> pixels.
# Usage: npm run icons   (CHROME=/path/to/chrome to use another Chrome)
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
if [ ! -x "$chrome" ]; then
	echo "Chrome not found at: $chrome" >&2
	echo "Set CHROME=/path/to/chrome (any Chrome or Chromium) and run again." >&2
	exit 1
fi
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT

for size in 16 32 48 128; do
	png="$root/icons/icon-$size.png"
	# Removed first, so a render that fails can't leave the old icon behind.
	rm -f "$png"
	"$chrome" --headless=new --disable-gpu --hide-scrollbars \
		--user-data-dir="$profile" \
		--force-device-scale-factor=1 \
		--default-background-color=00000000 \
		--window-size="$size,$size" \
		--screenshot="$png" \
		"file://$root/icons/src/icon-$size.svg" 2>/dev/null || true
	if [ ! -s "$png" ]; then
		echo "Rendering icons/src/icon-$size.svg failed" >&2
		exit 1
	fi
	echo "icons/icon-$size.png"
done
