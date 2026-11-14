#!/bin/sh
# Turns a screenshot taken in Chrome (any device pixel ratio, 16:10) into a
# Chrome Web Store screenshot: 1280x800, 24-bit PNG without alpha.
# Usage: sh scripts/store-shot.sh ~/Downloads/capture.png 2-bands-on-covers.png
# Cover anything personal (your Bandcamp avatar, top right) before running it.
set -eu

if [ $# -ne 2 ]; then
	echo "Usage: sh scripts/store-shot.sh <input.png> <name.png>" >&2
	exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
	echo "ffmpeg is needed (brew install ffmpeg)." >&2
	exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/store/screenshots/$2"
ffmpeg -v error -y -i "$1" -vf "scale=1280:800:flags=lanczos" -pix_fmt rgb24 "$out"
echo "store/screenshots/$2"
