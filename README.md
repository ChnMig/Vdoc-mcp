# Vdoc MCP

`@vdoc/mcp` is the installable MCP stdio adapter for Vdoc. It does not implement Vdoc business logic locally. It forwards MCP `tools/list` and `tools/call` requests to a Vdoc backend at `/api/v1/open/mcp`.

## Install

`@vdoc/mcp` is not published to the npm registry yet. Run or install the official GitHub repository directly:

```sh
npx --yes github:ChnMig/Vdoc-mcp
# Or install the GitHub version globally
npm install -g git+https://github.com/ChnMig/Vdoc-mcp.git
```

For one-off agent usage, prefer the `npx` GitHub source in the agent's MCP config.

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
      "args": ["--yes", "github:ChnMig/Vdoc-mcp"],
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
```
