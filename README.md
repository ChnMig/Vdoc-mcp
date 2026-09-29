<p>
  <img src="assets/vdoc-logo.png" width="96" height="96" alt="Vdoc logo" />
</p>

# Vdoc MCP and Skill

`@vdoc/mcp` contains the installable MCP stdio adapter and its optional [workflow Skill](skills/vdoc/README.md). It does not implement Vdoc business logic locally. It forwards MCP `tools/list` and `tools/call` requests to a Vdoc backend at `/api/v1/open/mcp`.

Since v0.3.7, both are maintained and released in this repository. The Skill lives at `skills/vdoc/`; its original Git history is preserved by a subtree merge, with historical tags under `skill/`. The former Vdoc-skill repository is not required for new installations or releases.

## Install

First [download and verify the Compose workspace bootstrap](https://chnmig.github.io/Vdoc-site/en/deployment). Its [source lock](https://github.com/ChnMig/Vdoc-site/blob/main/workspace/workspace.lock.json) is also browsable in Vdoc-site. Run the installation commands below from the extracted `vdoc-workspace` directory, or set `VDOC_WORKSPACE_LOCK` to its absolute lock path.

`@vdoc/mcp` is not published to the npm registry yet. Resolve the adapter
commit from a reviewed workspace bootstrap lock instead of a moving branch:

```sh
VDOC_WORKSPACE_LOCK="${VDOC_WORKSPACE_LOCK:-./workspace.lock.json}"
VDOC_MCP_COMMIT="$(jq -er '.repositories[] | select(.path == "Vdoc-mcp") | .commit' "$VDOC_WORKSPACE_LOCK")"
printf '%s' "$VDOC_MCP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
npx --yes "github:ChnMig/Vdoc-mcp#$VDOC_MCP_COMMIT"
```

For one-off agent usage, prefer the pinned `npx` GitHub source in the agent's
MCP config. Replace `<VDOC_MCP_COMMIT_FROM_WORKSPACE_LOCK>` in the shipped
examples with the resolved 40-character value before use. Do not remove the
fragment or replace it with a moving branch name. The reviewed lock is
distributed in the checksummed
[Vdoc-site Docker Compose workspace bootstrap](https://chnmig.github.io/Vdoc-site/en/deployment);
verify its `.sha256` file before running the workspace initializer.

## Optional Skill and linked updates

Install the prebuilt release selected by the reviewed lock, verify its checksum, then link its bundled Skill. Global Git installs can fail during npm's source preparation with `tsc: command not found`; the release archive already contains the compiled adapter.

```sh
(
  set -eu
  VDOC_WORKSPACE_LOCK="${VDOC_WORKSPACE_LOCK:-./workspace.lock.json}"
  VDOC_MCP_REF="$(jq -er '.repositories[] | select(.path == "Vdoc-mcp") | .ref' "$VDOC_WORKSPACE_LOCK")"
  printf '%s' "$VDOC_MCP_REF" | grep -Eq '^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
  VDOC_MCP_VERSION="${VDOC_MCP_REF#refs/tags/v}"
  VDOC_MCP_PACKAGE_DIR="$(mktemp -d)"
  trap 'rm -rf -- "$VDOC_MCP_PACKAGE_DIR"' EXIT
  VDOC_MCP_RELEASE="https://github.com/ChnMig/Vdoc-mcp/releases/download/v$VDOC_MCP_VERSION"
  curl -fsSL "$VDOC_MCP_RELEASE/vdoc-mcp-$VDOC_MCP_VERSION.tgz" -o "$VDOC_MCP_PACKAGE_DIR/vdoc-mcp-$VDOC_MCP_VERSION.tgz"
  curl -fsSL "$VDOC_MCP_RELEASE/SHA256SUMS" -o "$VDOC_MCP_PACKAGE_DIR/SHA256SUMS"
  (cd "$VDOC_MCP_PACKAGE_DIR" && shasum -a 256 -c SHA256SUMS)
  npm install --global "$VDOC_MCP_PACKAGE_DIR/vdoc-mcp-$VDOC_MCP_VERSION.tgz"
  vdoc-mcp skill install
)
```

To link an already installed package:

```sh
vdoc-mcp skill install
# Or select a different agent/project skill directory
vdoc-mcp skill install --directory "$HOME/.claude/skills/vdoc"
```

The default directory is `$HOME/.agents/skills/vdoc`. The installer does not need credentials and refuses to replace an existing installation. Preserve local changes and move the previous directory before migrating from Git or Skills CLI. Do not edit the linked package files; keep personal rules separately.

When the global MCP package is replaced at the same npm prefix, the directory link exposes the matching new Skill automatically, without `postinstall` hooks. To update, repeat the verified archive installation with the release from the newer reviewed lock. Once this package is published to npm and the user switches to a registry installation, `npm update --global @vdoc/mcp` can update both. No npm registry publication is claimed by this release.

Restart the MCP process and reload the agent after updates. Configure the globally installed `vdoc-mcp` command in the client if it should use that installation; an existing `npx` configuration pinned to an older Git commit remains on that commit. Keep the global package installed at the same path; changing Node installations or npm prefixes requires relinking. Do not link a Skill from a temporary `npx` cache.

For independent Skill installation through Skills CLI, see the [Skill README](skills/vdoc/README.md). Such installations have their own update lifecycle.

## Tool discovery

Tool definitions are loaded from the deployed backend; the adapter has no hardcoded tool inventory. Updated backends expose `list_document_branches` to resolve a branch before its first publication, and `list_api_endpoints` to resolve endpoint IDs by version, method and exact path. Pair the updated backend with Vdoc Skill. Older release locks may still expose the earlier tool set.

## Configuration

Set these environment variables in your agent MCP configuration:

| Variable | Required | Description |
|---|---:|---|
| `VDOC_BASE_URL` | Yes, unless `VDOC_MCP_URL` is set | Base Vdoc service URL. The adapter appends `/api/v1/open/mcp`. |
| `VDOC_MCP_URL` | Optional | Full Vdoc MCP endpoint URL. Overrides `VDOC_BASE_URL`. |
| `VDOC_MCP_TOKEN` | Yes | MCP token created in Vdoc. Keep it in local agent config or secret storage. |
| `VDOC_MCP_TIMEOUT_MS` | Optional | HTTP timeout in milliseconds. Defaults to `180000`; accepts integers from `1` through `180000`. Agent-host timeouts must also allow this window. |

Do not pass tokens as CLI arguments. The adapter sends diagnostics to stderr only; stdout is reserved for MCP protocol messages.

Do not put raw JWTs, MCP tokens, DB passwords, storage secrets, or `Authorization` header values in README files, logs, screenshots, issues, or shell history.

## Local Vdoc Closure Path

For a local backend and Admin that match the workspace docs, run from the workspace root:

```sh
scripts/vdoc-local-bootstrap.sh
docker compose --env-file .env up -d --build
cd Vdoc && go run ./tools/vdoc-demo-seed
```

The demo seed is optional. To run live backend E2E against the root Compose stack:

```sh
cd Vdoc
./scripts/vdoc-e2e.sh live-compose --env-file ../.env --check-only
./scripts/vdoc-e2e.sh live-compose --env-file ../.env
```

Live E2E resets the selected disposable `VDOC_TEST_POSTGRES_DB`, `vdoc_e2e` by default. It does not reset the application database from `VDOC_POSTGRES_DB`.

After the stack is healthy, verify the installable stdio adapter and deployed
backend as one black-box path:

```sh
cd Vdoc-mcp
VDOC_LIVE_AUDIT_EMPTY_DATABASE_CONFIRM=1 npm run verify:live-audit
```

This verifier only accepts a loopback backend and requires disposable local
registration plus an empty application database, so its registered user is the
first SuperAdmin. It creates and publishes a temporary document, reads an exact
endpoint through the real stdio transport, and then checks the private MCP
usage response for `adapter=stdio`,
`evidence_kind=published_content_read`, exact canonical entity IDs, and the
absence of secrets, schema/content, IP addresses, and User-Agent values. It
revokes the temporary MCP token and archives the temporary project before
returning; the disposable audit user and team remain in the local database
because v0.1 has no delete lifecycle for them.

The explicit empty-database confirmation is checked before the first HTTP
request. Do not set it for an existing application database; use an isolated
Compose project and volume set for this black-box check.

For a workspace whose default application database already has users, run the
check on isolated ports and Compose volumes from the workspace root:

```sh
VDOC_POSTGRES_HOST_PORT=15432 \
VDOC_RUSTFS_HOST_PORT=19000 \
VDOC_RUSTFS_CONSOLE_HOST_PORT=19001 \
VDOC_BACKEND_HOST_PORT=18080 \
docker compose --env-file .env -p vdoc-mcp-audit up -d --build postgres rustfs backend

cd Vdoc-mcp
VDOC_LIVE_AUDIT_BASE_URL=http://127.0.0.1:18080 \
VDOC_LIVE_AUDIT_EMPTY_DATABASE_CONFIRM=1 \
npm run verify:live-audit
cd ..

docker compose --env-file .env -p vdoc-mcp-audit down -v --remove-orphans
```

The final command permanently removes only the volumes created under the
explicit `vdoc-mcp-audit` Compose project name; inspect that project before
cleanup if the name was previously used for anything else.

Use the root release dry-run as the local gate before package release work:

```sh
scripts/vdoc-release-dry-run.sh --list
scripts/vdoc-release-dry-run.sh
```

The dry-run does not publish `@vdoc/mcp` or deploy any service.

## Agent Config Example

```json
{
  "mcpServers": {
    "vdoc": {
      "command": "npx",
      "args": ["--yes", "github:ChnMig/Vdoc-mcp#<VDOC_MCP_COMMIT_FROM_WORKSPACE_LOCK>"],
      "env": {
        "VDOC_BASE_URL": "https://your-vdoc.example.com",
        "VDOC_MCP_TOKEN": "REPLACE_WITH_LOCAL_VDOC_MCP_TOKEN"
      }
    }
  }
}
```

More examples are in `examples/`.

## Available Tools

The backend is the source of truth for tool definitions. The adapter calls Vdoc `tools/list` at runtime, so tool schemas stay aligned with the deployed backend.

Vdoc v0.1 exposes read tools for projects, documents, API versions, endpoint detail, API diffs, Markdown docs, and draft tools for OpenAPI/Markdown draft submission. Direct publish tools are not exposed in v0.1; publication remains a human Admin/SuperAdmin review action.

## Automated Releases

For a new version, update `package.json` and `package-lock.json` together with `npm version 0.1.1 --no-git-tag-version` (substitute the intended version), commit the changes, and push the matching `v0.1.1` tag. CI requires the tag to match both manifests, runs tests and packaging checks, then creates a [GitHub Release](https://github.com/ChnMig/Vdoc-mcp/releases) containing `vdoc-mcp-<version>.tgz` and `SHA256SUMS`. A tag such as `v0.1.1-rc.1` creates a prerelease; ordinary branch pushes and pull requests run checks only. Existing releases are not overwritten.

The adapter's MCP handshake and HTTP user-agent use the package version. This workflow uploads npm-format packages to GitHub Releases; npm registry publication remains separate.

For local packaging, run `npm run release:package -- v0.3.8` with the version in the package manifests. Output stays in the ignored `.artifacts/release/` directory. After downloading a published archive and verifying `SHA256SUMS`, install it with `npm install -g ./vdoc-mcp-<version>.tgz`. Select the release matching the reviewed workspace lock.

## Development

```sh
npm install
npm run build
npm test
VDOC_LIVE_AUDIT_EMPTY_DATABASE_CONFIRM=1 npm run verify:live-audit
```
