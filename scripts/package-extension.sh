#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir="$project_dir/dist"
flavor=${1:-base}

case "$flavor" in
  base|ai-dev) ;;
  *)
    printf 'Unknown build flavor: %s\n' "$flavor" >&2
    exit 1
    ;;
esac

staging_dir="$output_dir/phraselet-$flavor"
version=$(node -p "require('$project_dir/manifest.json').version")
archive="$output_dir/phraselet-$flavor-$version.zip"

rm -rf "$staging_dir"
rm -f "$archive"
mkdir -p "$staging_dir/src" "$staging_dir/assets"

cp "$project_dir/manifest.json" "$staging_dir/"
cp "$project_dir/popup.html" "$project_dir/options.html" "$project_dir/onboarding.html" "$staging_dir/"
cp "$project_dir/src/background.js" "$project_dir/src/features.js" "$project_dir/src/popup.js" "$project_dir/src/options.js" "$project_dir/src/onboarding.js" "$project_dir/src/shared.css" "$staging_dir/src/"
cp "$project_dir/assets/icon-16.png" "$project_dir/assets/icon-32.png" "$project_dir/assets/icon-48.png" "$project_dir/assets/icon-128.png" "$staging_dir/assets/"

if [ "$flavor" = "ai-dev" ]; then
  cp -R "$project_dir/src/enrichment" "$staging_dir/src/"
fi

node "$project_dir/scripts/configure-build.mjs" "$staging_dir" "$flavor"

(
  cd "$staging_dir"
  zip -q -r "$archive" .
)

printf '%s\n' "$archive"
