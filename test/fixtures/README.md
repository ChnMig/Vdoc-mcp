These synthetic responses come from the backend's real create/review/publish
and MCP routes (`TestMCPResponsePreservesSchemaNumbers`). They cover exact schema
numbers and an enum change between adjacent integers above Number.MAX_SAFE_INTEGER.

To verify the current backend and adapter together, create a temporary directory,
set `VDOC_MCP_NUMERIC_FIXTURE_DIR` to its absolute path, then run:

1. In Vdoc: `GOTOOLCHAIN=go1.25.5 GOFLAGS=-mod=readonly go test ./api/app/v1/open/mcp -run '^TestMCPResponsePreservesSchemaNumbers$' -count=1`
2. In Vdoc-mcp, with the same environment variable: `npm test`

Without that variable, adapter tests use the checked-in response fixtures.
