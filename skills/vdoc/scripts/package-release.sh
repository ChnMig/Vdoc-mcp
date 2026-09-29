#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
release_tag="${1:-}"
[[ "$release_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  printf 'Use npm run release:package -- vMAJOR.MINOR.PATCH (optionally with a prerelease suffix)\n' >&2
  exit 1
}
cd "$ROOT_DIR"
node --input-type=module - "$release_tag" <<'JS'
import { readFileSync } from 'node:fs';
const version = process.argv[2].slice(1);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
if ([pkg.version, lock.version, lock.packages[''].version].some(value => value !== version)) {
  console.error('Release tag must match package.json and package-lock.json; run npm version ' + version + ' --no-git-tag-version, commit, then tag that commit.');
  process.exit(1);
}
JS

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
npm pack --pack-destination "$stage"
(
  cd "$stage"
  shasum -a 256 ./*.tgz | sed 's|  ./|  |' >SHA256SUMS
)
output="$ROOT_DIR/.artifacts/release"
mkdir -p "$output"
rm -f -- "$output"/*.tgz "$output/SHA256SUMS"
cp "$stage/"*.tgz "$stage/SHA256SUMS" "$output/"
printf 'Package release prepared: %s\n' "$output"
