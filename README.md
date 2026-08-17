# Vdoc MCP

`@vdoc/mcp` is the installable MCP stdio adapter for Vdoc. It does not implement Vdoc business logic locally. It forwards MCP `tools/list` and `tools/call` requests to a Vdoc backend at `/api/v1/open/mcp`.

## Install

`@vdoc/mcp` is not published to the npm registry yet. Resolve the adapter
commit from a reviewed workspace bootstrap lock instead of a moving branch:

```sh
VDOC_WORKSPACE_LOCK="${VDOC_WORKSPACE_LOCK:-../workspace.lock.json}"
VDOC_MCP_COMMIT="$(jq -er '.repositories[] | select(.path == "Vdoc-mcp") | .commit' "$VDOC_WORKSPACE_LOCK")"
printf '%s' "$VDOC_MCP_COMMIT" | grep -Eq '^[0-9a-f]{40}$'
npx --yes "github:ChnMig/Vdoc-mcp#$VDOC_MCP_COMMIT"
# Or install the GitHub version globally
npm install -g "git+https://github.com/ChnMig/Vdoc-mcp.git#$VDOC_MCP_COMMIT"
```

For one-off agent usage, prefer the pinned `npx` GitHub source in the agent's
MCP config. Replace `<VDOC_MCP_COMMIT_FROM_WORKSPACE_LOCK>` in the shipped
examples with the resolved 40-character value before use. Do not remove the
fragment or replace it with a moving branch name. A standalone immutable
install channel is not claimed until a release tag or checksummed bootstrap is
published.

## Configuration

Set these environment variables in your agent MCP configuration:

| Variable | Required | Description |
|---|---:|---|
| `VDOC_BASE_URL` | Yes, unless `VDOC_MCP_URL` is set | Base Vdoc service URL. The adapter appends `/api/v1/open/mcp`. |
| `VDOC_MCP_URL` | Optional | Full Vdoc MCP endpoint URL. Overrides `VDOC_BASE_URL`. |
| `VDOC_MCP_TOKEN` | Yes | MCP token created in Vdoc. Keep it in local agent config or secret storage. |
| `VDOC_MCP_TIMEOUT_MS` | Optional | HTTP timeout in milliseconds. Defaults to `30000`. |

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

## Development

```sh
npm install
npm run build
npm test
VDOC_LIVE_AUDIT_EMPTY_DATABASE_CONFIRM=1 npm run verify:live-audit
```
