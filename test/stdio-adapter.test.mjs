import assert from "node:assert/strict";
import http from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

test("stdio adapter exposes backend tools through MCP", async (t) => {
  const server = await startBackendMock();
  t.after(() => server.close());

  const address = server.address();
  const client = new Client({ name: "vdoc-mcp-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "index.js")],
    env: {
      VDOC_MCP_URL: `http://127.0.0.1:${address.port}/api/v1/open/mcp`,
      VDOC_MCP_TOKEN: "vdoc_stdio_test_token",
      VDOC_MCP_TIMEOUT_MS: "1000",
    },
  });
  t.after(async () => client.close());

  await client.connect(transport);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_projects"]);

  const result = await client.callTool({ name: "list_projects", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), [{ id: "proj_1", name: "Example" }]);
});

async function startBackendMock() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(req.headers.authorization, "vdoc_stdio_test_token");
      assert.equal(req.headers["user-agent"], "vdoc-mcp/0.1.0 (stdio)");
      assert.equal(req.headers["x-vdoc-adapter"], "stdio");
      res.setHeader("content-type", "application/json");
      if (body.method === "tools/list") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [{ name: "list_projects", description: "List projects", inputSchema: { type: "object" } }],
          },
        }));
        return;
      }
      if (body.method === "tools/call") {
        assert.deepEqual(body.params, { name: "list_projects", arguments: {} });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: [{ id: "proj_1", name: "Example" }],
        }));
        return;
      }
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "method not found" },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}
