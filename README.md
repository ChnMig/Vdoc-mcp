<p>
  <img src="assets/vdoc-logo.png" width="96" height="96" alt="Vdoc logo" />
</p>

# Vdoc MCP

`@chnmig/vdoc-mcp` is the MCP stdio adapter for Vdoc document management. It forwards `tools/list` and `tools/call` to the Vdoc backend at `/api/v1/open/mcp`; authorization, persistence and business logic stay on the backend. Your agent or application decides how to use the documents. No companion Skill is installed.

## Install with npm

Requires Node.js 20+ and npm. This development release uses the Beta channel:

```sh
npx --yes @chnmig/vdoc-mcp@beta --version
```

Use the same package spec in the agent configuration; the adapter needs `VDOC_BASE_URL` and `VDOC_MCP_TOKEN` to connect. The `--version` flag above only checks the executable.

| Channel | npx package spec | Updates |
|---|---|---|
| Beta | `@chnmig/vdoc-mcp@beta` | Latest published beta on each new MCP process |
| Stable | `@chnmig/vdoc-mcp@latest` | Latest published stable release on each new MCP process |

Use `@latest` with a stable backend and `@beta` with an isolated beta backend. Stable publications update only `@latest`; beta publications update only `@beta`. Restart MCP to resolve a new tag. A running process does not update in place. An unavailable channel fails instead of falling back to another channel.

For a global command instead of npx:

```sh
npm install --global @chnmig/vdoc-mcp@latest
vdoc-mcp --version
# Update in the same channel:
npm install --global @chnmig/vdoc-mcp@latest
# Remove the global package only if no other project uses it:
npm uninstall --global @chnmig/vdoc-mcp
```

Use `@beta` with the matching beta backend and `@latest` with a stable backend. To keep a deployment on an exact version, use `@chnmig/vdoc-mcp@0.4.1-beta.1` instead of a moving tag. npm installation ships compiled JavaScript and does not need Git or a TypeScript compiler.

The workbench provides a one-sentence install, update or uninstall prompt. Its [agent installation guide](https://github.com/ChnMig/Vdoc-site/blob/v0.4.1-beta.1/docs/public/mcp-install.md) covers private configuration and existing installations.

## Client and server versions

On the first successful backend request, the adapter reads `X-Vdoc-Server-Version` from the actual connected server and compares it with its own package version, including beta labels. A mismatch emits a warning through MCP logging and stderr with both versions and alignment advice. The tools remain available. Repeated warnings for the same state are suppressed; a changed server version is checked again.

If an older server or proxy does not report a recognizable version, the adapter reports that the version could not be verified. Successful tool calls do not prove matching versions. Align the client and backend to the same release, or pin the client to the backend's exact version, then restart MCP. No separate version probe or document permission is required.

## GitHub channel installations

Existing GitHub channel installations remain supported. They install separately under `$HOME/.local/share/vdoc/mcp/release` and `$HOME/.local/share/vdoc/mcp/beta`. Download the standalone installer and its checksum from a reviewed release containing these assets:

```sh
(
  set -eu
  VDOC_MCP_INSTALLER_TAG="v0.4.1-beta.1"
  VDOC_MCP_INSTALLER_DIR="$(mktemp -d)"
  trap 'rm -rf -- "$VDOC_MCP_INSTALLER_DIR"' EXIT
  VDOC_MCP_INSTALLER_RELEASE="https://github.com/ChnMig/Vdoc-mcp/releases/download/$VDOC_MCP_INSTALLER_TAG"
  curl -fsSL "$VDOC_MCP_INSTALLER_RELEASE/install-channel.mjs" -o "$VDOC_MCP_INSTALLER_DIR/install-channel.mjs"
  curl -fsSL "$VDOC_MCP_INSTALLER_RELEASE/install-channel.mjs.sha256" -o "$VDOC_MCP_INSTALLER_DIR/install-channel.mjs.sha256"
  (cd "$VDOC_MCP_INSTALLER_DIR" && shasum -a 256 -c install-channel.mjs.sha256)
  node "$VDOC_MCP_INSTALLER_DIR/install-channel.mjs" --channel beta
)
```

The installer selects the latest published release in its channel, verifies its archive against `SHA256SUMS`, and prints the absolute command and update command. Preserve its prefix and channel when updating. Testing uses `--channel beta`. Existing global packages and agent settings are preserved.

New packages use `node_modules/@chnmig/vdoc-mcp`; historical archives used `node_modules/@vdoc/mcp`. The new installer accepts both names. For the first upgrade from an older combined MCP/Skill package, use the newly downloaded installer, since older bundled updaters require the retired Skill files. Remove only an identifiable old Vdoc Skill link, preserving independently maintained files.

## Reproduce a workspace source version

The [verified Compose workspace bootstrap](https://chnmig.github.io/Vdoc-site/en/deployment) includes the exact source lock. For source reproduction, run from its extracted `vdoc-workspace` directory:

```sh
(
  set -eu
  VDOC_WORKSPACE_LOCK="${VDOC_WORKSPACE_LOCK:-./workspace.lock.json}"
  VDOC_MCP_COMMIT="$(jq -er '.repositories[] | select(.path == "Vdoc-mcp") | .commit' "$VDOC_WORKSPACE_LOCK")"
  printf '%s' "$VDOC_MCP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
  npx --yes "github:ChnMig/Vdoc-mcp#$VDOC_MCP_COMMIT"
)
```

The workspace source lock remains exact and independent of the convenient npm channels. To install the prebuilt archive for that lock instead:

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
)
```

## Tool discovery

Tool definitions come from the deployed backend; the adapter has no hardcoded inventory. Discover the runtime schemas before making calls. Select the environment, project and document, list that document's branches, and resolve an exact commit before reading, comparing or saving.

Writes use the observed branch head/generation and a stable idempotency key. Conflicts require rereading and reconciliation; after an unknown outcome, retry the identical payload and key. Commit identities and numbered versions are generated by the backend. Only an exact release confirms publication; humans approve and publish in the workbench.

The current discovery list advertises only document repository tools. Use `search_documents` for keyword discovery, `get_document_section` for optional line/heading/operation views, and `apply_document_patch` for exact anchored text edits. Full raw reads, full-file replacement and original downloads remain available independently of parsers. Current storage accepts UTF-8 text, not arbitrary binary uploads.

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

The dry-run does not publish `@chnmig/vdoc-mcp` or deploy any service.

## Agent Config Example

```json
{
  "mcpServers": {
    "vdoc": {
      "command": "npx",
      "args": ["--yes", "@chnmig/vdoc-mcp@beta"],
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

The backend is the source of truth for remote tool definitions. The adapter calls Vdoc `tools/list` at runtime, so remote tool schemas stay aligned with the deployed backend. When `get_document_at_commit` is available, the adapter also exposes `download_document_at_commit` for local source-file downloads.

The current MCP workflow uses immutable project commits: discover a branch, pin its head/generation, read exact content, compare commits, atomically append changes with an idempotency key, analyze exact revisions and propose merges. The server generates commit IDs, new document IDs and release version names. Humans approve and publish in the workbench. Legacy version reads remain compatible; converted projects reject legacy draft writes. Runtime tool discovery supplies the complete supported schemas.

### Download a source file locally

Ask the agent to download a document's chosen branch or release to an absolute file path. It resolves an exact commit, then calls `download_document_at_commit` with `project_id`, `document_id`, `commit_id` and `output_path` (for example `/home/me/project/docs/api.yaml`). The adapter saves the original UTF-8 bytes for OpenAPI JSON/YAML, Markdown or TXT, retaining comments, formatting, BOM and line endings. It verifies the source SHA-256 and returns `file_path`, `byte_length`, `sha256`, `commit_id` and `document_id`; it does not send the entire document back into the conversation.

Downloads use the existing backend read permissions and audits, with a 10 MiB source-file limit. Missing parent directories are created. Files are created privately and existing destinations, including symlinks, are never overwritten; choose another filename if needed. Only the explicit `output_path` controls the destination. This tool runs in the stdio adapter: a remote/containerized adapter writes on that machine, so use a shared mount to access the file locally. A direct backend HTTP connection still returns content through `get_document_at_commit`.

## Automated Releases

For a new version, update `package.json` and `package-lock.json` together with `npm version 0.1.1 --no-git-tag-version` (substitute the intended version), commit the changes, and push the matching `v0.1.1` tag. CI requires the tag to match both manifests, runs tests and packaging checks, then creates a [GitHub Release](https://github.com/ChnMig/Vdoc-mcp/releases) containing `vdoc-mcp-<version>.tgz`, `SHA256SUMS`, `install-channel.mjs` and `install-channel.mjs.sha256`. `SHA256SUMS` continues to cover the package archive only; the standalone installer has its own checksum for initial setup. Ordinary branch pushes and pull requests run checks only. Existing releases are not overwritten.

Use `vMAJOR.MINOR.PATCH-beta.N` for channel beta, for example `v0.4.0-beta.1`: CI creates a prerelease, and only beta installations select it. Promote a validated version by building and tagging `vMAJOR.MINOR.PATCH`, such as `v0.4.0`: the release channel then selects that stable package. Other prerelease tags, such as `-rc.1`, remain supported by packaging but are not selected by either channel installer. Package versions must match their tags; do not copy a beta archive into a stable release.

For the first channel rollout, publish and verify the beta prerelease first, then publish the stable release from the same validated implementation with only the package version changed. Each tag needs its own matching manifest versions and four release assets. Before publishing a beta installation guide, verify that a `-beta.N` prerelease exists and pin its installer download to a reviewed release containing the installer assets. A stable release alone does not initialize the beta channel. Historical releases without the installer assets are rejected before npm runs; the installed package is also checked for its bundled channel updater.

The MCP handshake and HTTP user-agent use the package version. Publish the verified GitHub archive to npm using `scripts/publish-npm.sh v<version>`. It selects `beta` for beta releases and `latest` for stable releases, and refuses other prerelease formats. The same archive is used for GitHub and npm. First publication uses an authenticated maintainer session; an optional GitHub trusted publisher can automate subsequent releases without a stored npm token.

For local packaging, run `npm run release:package -- v0.3.10` with the version in the package manifests. Output stays in the ignored `.artifacts/release/` directory. After downloading a published archive and verifying `SHA256SUMS`, install it with `npm install -g ./vdoc-mcp-<version>.tgz`. Select the release matching the reviewed workspace lock.

## Development

```sh
npm install
npm run build
npm test
VDOC_LIVE_AUDIT_EMPTY_DATABASE_CONFIRM=1 npm run verify:live-audit
```

To enable automatic npm releases after the first publication, add a trusted publisher in the npm package settings for GitHub owner `ChnMig`, repository `Vdoc-mcp`, workflow `ci.yml`, with direct publish allowed. Then set the GitHub repository variable `NPM_TRUSTED_PUBLISHING=true`. The optional npm job downloads the tested archive, validates its identity/checksum and uses OIDC with provenance. Until that trust is configured, GitHub releases remain automatic and an authenticated maintainer runs the publish script locally; no npm token is stored in the repository.
