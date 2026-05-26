# Vdoc MCP

`@vdoc/mcp` is the installable MCP stdio adapter for Vdoc. It does not implement Vdoc business logic locally. It forwards MCP `tools/list` and `tools/call` requests to a Vdoc backend at `/api/v1/open/mcp`.

## Install

```sh
npm install -g @vdoc/mcp
```

For one-off agent usage, run it through `npx` in the agent's MCP config.

## Configuration

Set these environment variables in your agent MCP configuration:

| Variable | Required | Description |
|---|---:|---|
| `VDOC_BASE_URL` | Yes, unless `VDOC_MCP_URL` is set | Base Vdoc service URL. The adapter appends `/api/v1/open/mcp`. |
| `VDOC_MCP_URL` | Optional | Full Vdoc MCP endpoint URL. Overrides `VDOC_BASE_URL`. |
| `VDOC_MCP_TOKEN` | Yes | MCP token created in Vdoc. Keep it in local agent config or secret storage. |
| `VDOC_MCP_TIMEOUT_MS` | Optional | HTTP timeout in milliseconds. Defaults to `30000`. |

Do not pass tokens as CLI arguments. The adapter sends diagnostics to stderr only; stdout is reserved for MCP protocol messages.

## Agent Config Example

```json
{
  "mcpServers": {
    "vdoc": {
      "command": "npx",
      "args": ["-y", "@vdoc/mcp"],
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
