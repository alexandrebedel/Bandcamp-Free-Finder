#!/bin/sh
# Renders store/promo/src/{small,marquee}.html to the Chrome Web Store promo
# tiles (24-bit PNG, no alpha) with headless Chrome and ffmpeg.
# Usage: npm run promo   (CHROME=/path/to/chrome to use another Chrome)
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
if [ ! -x "$chrome" ]; then
	echo "Chrome not found at: $chrome (set CHROME=/path/to/chrome)" >&2
	exit 1
fi
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is needed (brew install ffmpeg)." >&2; exit 1; }
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT

render() { # name width height
	tmp="$profile/$1.png"
	"$chrome" --headless=new --disable-gpu --hide-scrollbars \
		--user-data-dir="$profile" --force-device-scale-factor=1 \
		--window-size="$2,$3" --screenshot="$tmp" \
		"file://$root/store/promo/src/$1.html" 2>/dev/null || true
	[ -s "$tmp" ] || { echo "Rendering $1 failed" >&2; exit 1; }
	ffmpeg -v error -y -i "$tmp" -pix_fmt rgb24 "$root/store/promo/$1-$2x$3.png"
	echo "store/promo/$1-$2x$3.png"
}

render small 440 280
render marquee 1400 560
