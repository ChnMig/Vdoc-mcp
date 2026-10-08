import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageInfo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

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
  assert.equal(client.getServerVersion().version, packageInfo.version);
  assert.match(client.getInstructions(), /explicit branch_id/);
  assert.match(client.getInstructions(), /get_doc_version/);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_projects", "list_document_branches", "list_api_endpoints"]);

  const result = await client.callTool({ name: "list_projects", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), [{ id: "proj_1", name: "Example" }]);

  const branches = await client.callTool({ name: "list_document_branches", arguments: { project_id: "proj_1", document_id: "doc_1" } });
  assert.equal(branches.isError, undefined);
  assert.equal(JSON.parse(branches.content[0].text)[0].id, "branch_1");
  const endpoints = await client.callTool({ name: "list_api_endpoints", arguments: { project_id: "proj_1", document_id: "doc_1", version_id: "ver_1", method: "GET", path: "/widgets/{id}" } });
  assert.equal(endpoints.isError, undefined);
  assert.equal(JSON.parse(endpoints.content[0].text)[0].id, "endpoint_1");
});

test("stdio discovery errors preserve code and safe data while removing nested credentials", async (t) => {
  const configuredToken = "fixture.token+$[synthetic]";
  const bearer = "Bearer synthetic.jwt.only";
  const genericToken = "vdoc_synthetic_error_only";
  const cases = [
    {
      data: {
        status: "FAILED_PRECONDITION", code: 400, retryable: false, missing: null,
        detail: `rejected ${configuredToken}`,
        nested: [{ Authorization: bearer }, { aUtHoRiZaTiOn: { value: configuredToken } }, { tokens: [configuredToken, genericToken] }],
        [`key-${configuredToken}`]: "safe",
      },
      expected: {
        status: "FAILED_PRECONDITION", code: 400, retryable: false, missing: null,
        detail: "rejected [redacted]",
        nested: [{ Authorization: "[redacted]" }, { aUtHoRiZaTiOn: "[redacted]" }, { tokens: ["[redacted]", "vdoc_[redacted]"] }],
        "key-[redacted]": "safe",
      },
    },
    { data: [null, true, 400, { authorization: bearer }], expected: [null, true, 400, { authorization: "[redacted]" }] },
    { data: `token=${configuredToken}; Authorization: ${bearer}`, expected: "token=[redacted]; Authorization: [redacted]" },
    ...[null, true, 400, {}, []].map(data => ({ data, expected: data })),
    { data: undefined, expected: undefined },
  ];
  let fixture = cases[0];
  const successText = JSON.stringify({ content: `Document data: ${configuredToken}, ${genericToken}; Authorization: ${bearer}` });
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.headers.authorization, configuredToken);
    res.setHeader("content-type", "application/json");
    if (body.params?.name === "successful_document") {
      res.end(`{"jsonrpc":"2.0","id":${JSON.stringify(body.id)},"result":${successText}}`);
    } else {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: {
        code: -32010, message: `failed precondition for ${configuredToken}`, data: fixture.data,
      } }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const client = new Client({ name: "vdoc-error-boundary-test", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "dist", "index.js")],
    env: {
      VDOC_MCP_URL: `http://127.0.0.1:${server.address().port}/api/v1/open/mcp`,
      VDOC_MCP_TOKEN: configuredToken,
      VDOC_MCP_TIMEOUT_MS: "1000",
    },
  });
  t.after(async () => {
    await client.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await client.connect(transport);
  for (const entry of cases) {
    fixture = entry;
    const before = JSON.stringify(entry.data);
    await assert.rejects(() => client.listTools(), error => {
      assert.equal(error.code, -32010, "the upstream RPC code must remain available");
      assert.deepEqual(error.data, entry.expected);
      for (const secret of [configuredToken, bearer, genericToken]) {
        assert.equal(JSON.stringify({ message: error.message, data: error.data }).includes(secret), false);
      }
      assert.match(error.message, /failed precondition for \[redacted\]/);
      return true;
    });
    const toolError = await client.callTool({ name: "fixture", arguments: {} });
    assert.equal(toolError.isError, true);
    for (const secret of [configuredToken, bearer, genericToken]) {
      assert.equal(JSON.stringify(toolError).includes(secret), false);
    }
    assert.equal(JSON.stringify(entry.data), before);
  }
  const success = await client.callTool({ name: "successful_document", arguments: {} });
  assert.notEqual(success.isError, true);
  assert.equal(success.content[0].text, successText, "successful document content must remain exact");
});

async function startBackendMock() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.equal(req.headers.authorization, "vdoc_stdio_test_token");
      assert.equal(req.headers["user-agent"], `vdoc-mcp/${packageInfo.version} (stdio)`);
      assert.equal(req.headers["x-vdoc-adapter"], "stdio");
      res.setHeader("content-type", "application/json");
      if (body.method === "tools/list") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: ["list_projects", "list_document_branches", "list_api_endpoints"].map((name) => ({ name, inputSchema: { type: "object" } })),
          },
        }));
        return;
      }
      if (body.method === "tools/call") {
        const fixtures = {
          list_projects: { args: {}, result: [{ id: "proj_1", name: "Example" }] },
          list_document_branches: { args: { project_id: "proj_1", document_id: "doc_1" }, result: [{ id: "branch_1", name: "dev", document_id: "doc_1" }] },
          list_api_endpoints: { args: { project_id: "proj_1", document_id: "doc_1", version_id: "ver_1", method: "GET", path: "/widgets/{id}" }, result: [{ id: "endpoint_1", method: "GET", path: "/widgets/{id}" }] },
        };
        const fixture = fixtures[body.params.name];
        assert.ok(fixture, `unexpected tool ${body.params.name}`);
        assert.deepEqual(body.params.arguments, fixture.args);
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: fixture.result,
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
