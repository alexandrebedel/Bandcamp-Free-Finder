#!/bin/sh
# Renders icons/src/icon-<size>.svg to icons/icon-<size>.png with headless
# Chrome, on a transparent background, at exactly <size> pixels.
# Usage: npm run icons   (CHROME=/path/to/chrome to override)
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT

for size in 16 32 48 128; do
	"$chrome" --headless=new --disable-gpu --hide-scrollbars \
		--user-data-dir="$profile" \
		--force-device-scale-factor=1 \
		--default-background-color=00000000 \
		--window-size="$size,$size" \
		--screenshot="$root/icons/icon-$size.png" \
		"file://$root/icons/src/icon-$size.svg" 2>/dev/null
	echo "icons/icon-$size.png"
done
