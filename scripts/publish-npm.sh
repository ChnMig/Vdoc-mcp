#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
release_tag="${1:-}"
mode="${2:-}"
[[ $# -ge 1 && $# -le 2 && ( -z "$mode" || "$mode" == --dry-run ) ]] || { printf 'Usage: scripts/publish-npm.sh vVERSION [--dry-run]\n' >&2; exit 1; }
if [[ "$release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-beta\.(0|[1-9][0-9]*)$ ]]; then
  channel=beta
elif [[ "$release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  channel=latest
else
  printf 'Only stable and beta.N releases have npm channels.\n' >&2; exit 1
fi
archive="$ROOT_DIR/.artifacts/release/vdoc-mcp-${release_tag#v}.tgz"
node --input-type=module - "$ROOT_DIR" "$release_tag" "$archive" <<'JS'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
const [root, tag, archive] = process.argv.slice(2);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packed = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }));
const sum = createHash('sha256').update(readFileSync(archive)).digest('hex');
const entries = readFileSync(join(dirname(archive), 'SHA256SUMS'), 'utf8').trim().split(/\r?\n/);
if (entries.filter(line => line === `${sum}  ${basename(archive)}`).length !== 1) throw new Error('Release archive checksum mismatch');
if (pkg.name !== '@chnmig/vdoc-mcp' || packed.name !== pkg.name || packed.version !== tag.slice(1) || pkg.version !== packed.version) throw new Error('Release tag, source and archive must match');
JS
options=(publish "$archive" --registry=https://registry.npmjs.org/ --access public --tag "$channel")
if [[ "$mode" == --dry-run ]]; then options+=(--dry-run); fi
npm "${options[@]}"
