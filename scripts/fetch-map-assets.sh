#!/usr/bin/env bash
# One-time: copy Protomaps glyphs + "light" sprites into public/map-assets (committed, ~11 MB).
set -euo pipefail
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --quiet --depth 1 https://github.com/protomaps/basemaps-assets "$tmp/assets"
rm -rf public/map-assets
mkdir -p public/map-assets/fonts public/map-assets/sprites
cp -R "$tmp/assets/fonts/." public/map-assets/fonts/
cp "$tmp/assets/sprites/v4/light"* public/map-assets/sprites/
echo "Copied $(find public/map-assets -type f | wc -l | tr -d ' ') files."
