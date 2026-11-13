#!/bin/sh
# Check that https://me7.network serves exactly what this source builds.
# Builds the site, downloads every file of it from the live site (the wallet's page, its
# scripts and styles, the public pages) and compares SHA-256 sums. Needs: node, npm ci done, curl, shasum or sha256sum.
set -eu
SITE="${ME7_SITE:-https://me7.network}"
cd "$(dirname "$0")"

sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

echo "== build"
node node_modules/vite/bin/vite.js build >/dev/null 2>&1

LIVE="$(mktemp -d)"
trap 'rm -rf "$LIVE"' EXIT
curl -sfL "$SITE/index.html" -o "$LIVE/index.html"

# The files to compare: everything the build produced, and everything the live page names.
FILES="$( ( (cd dist && find . -type f | sed 's|^\./||' | grep -v '^version.txt$'); grep -oE 'assets/[A-Za-z0-9_.-]+' "$LIVE/index.html") | sort -u)"

echo "== compare with $SITE"
BAD=0
for f in $FILES; do
	mkdir -p "$LIVE/$(dirname "$f")"
	if [ "$f" != index.html ]; then curl -sfL "$SITE/$f" -o "$LIVE/$f" || true; fi
	if [ -f "dist/$f" ] && [ -f "$LIVE/$f" ] && [ "$(sum "dist/$f")" = "$(sum "$LIVE/$f")" ]; then
		echo "match   $f"
	else
		echo "DIFFER  $f"
		BAD=1
	fi
done

if [ "$BAD" = 0 ]; then
	echo "== the site serves this code."
else
	echo "== the site differs from this source. If a release went out minutes ago, try again later; otherwise tell us (SECURITY.md)." >&2
	exit 1
fi
