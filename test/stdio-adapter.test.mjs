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
  assert.match(client.getInstructions(), /search_documents/);
  assert.match(client.getInstructions(), /get_document_section/);
  assert.match(client.getInstructions(), /Parsing failures never prevent get_document_at_commit or raw downloads/);
  assert.match(client.getInstructions(), /apply_document_patch requires read and write capabilities/);
  assert.match(client.getInstructions(), /independent branches and immutable commit history/);
  assert.match(client.getInstructions(), /idempotency key/);
  assert.match(client.getInstructions(), /The server generates commit IDs/);
  assert.match(client.getInstructions(), /delete_folder only removes empty folders/);

  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_projects", "list_branches", "get_document_section", "search_documents", "apply_document_patch", "commit_changes", "list_folders", "create_folder", "update_folder", "delete_folder", "update_document", "delete_document"]);

  const result = await client.callTool({ name: "list_projects", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), [{ id: "proj_1", name: "Example" }]);

  const branches = await client.callTool({ name: "list_branches", arguments: { project_id: "proj_1", document_id: "doc_1" } });
  assert.equal(branches.isError, undefined);
  assert.equal(JSON.parse(branches.content[0].text)[0].id, "branch_1");
  const endpoints = await client.callTool({ name: "get_document_section", arguments: { project_id: "proj_1", document_id: "doc_1", commit_id: "a".repeat(64), kind: "openapi_operation", method: "GET", path: "/widgets/{id}" } });
  assert.equal(endpoints.isError, undefined);
  assert.equal(JSON.parse(endpoints.content[0].text).content_kind, "derived_json");
  const search = await client.callTool({ name: "search_documents", arguments: { project_id: "proj_1", query: "原始", limit: 1 } });
  assert.equal(JSON.parse(search.content[0].text).matches[0].snippet, "\ufeff原始\r\n");
  const patch = await client.callTool({ name: "apply_document_patch", arguments: { project_id: "proj_1", document_id: "doc_1", branch_id: "branch_1", expected_head_commit_id: "a".repeat(64), expected_generation: 7, idempotency_key: "patch-stdio-fixture", edits: [{ old_text: "原始\r\n", new_text: "完整\r\n" }] } });
  assert.equal(JSON.parse(patch.content[0].text).id, "c".repeat(64));
  const committed = await client.callTool({ name: "commit_changes", arguments: {
    project_id: "proj_1", document_id: "doc_1", branch_id: "branch_1", expected_head_commit_id: "a".repeat(64),
    expected_generation: 7, idempotency_key: "request-fixture-1",
    changes: [{ operation: "upsert", document_id: "doc_1", relative_path: "empty.txt", name: "Empty", document_type: 3, content: "" }],
  } });
  assert.equal(committed.isError, undefined);
  assert.equal(JSON.parse(committed.content[0].text).id, "b".repeat(64));
  for (const [name, args, expected] of [
    ["list_folders", { project_id: "proj_1" }, [{ path: "目录", name: "目录" }]],
    ["create_folder", { project_id: "proj_1", name: "目录", parent_path: "" }, { path: "目录", name: "目录" }],
    ["update_folder", { project_id: "proj_1", path: "目录/子目录", name: "新目录", parent_path: "" }, { path: "新目录", name: "新目录" }],
    ["delete_folder", { project_id: "proj_1", path: "新目录" }, { deleted: true }],
    ["update_document", { project_id: "proj_1", document_id: "doc_1", name: "新名称", relative_path: "文件.md", description: "" }, { id: "doc_1", name: "新名称", relative_path: "文件.md", description: "" }],
    ["delete_document", { project_id: "proj_1", document_id: "doc_1" }, { deleted: true }],
  ]) {
    const response = await client.callTool({ name, arguments: args });
    assert.equal(response.isError, undefined, name);
    assert.deepEqual(JSON.parse(response.content[0].text), expected, name);
  }
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
            tools: ["list_projects", "list_branches", "get_document_section", "search_documents", "apply_document_patch", "commit_changes", "list_folders", "create_folder", "update_folder", "delete_folder", "update_document", "delete_document"].map((name) => ({ name, inputSchema: { type: "object" } })),
          },
        }));
        return;
      }
      if (body.method === "tools/call") {
        const fixtures = {
          list_projects: { args: {}, result: [{ id: "proj_1", name: "Example" }] },
          list_folders: { args: { project_id: "proj_1" }, result: [{ path: "目录", name: "目录" }] },
          create_folder: { args: { project_id: "proj_1", name: "目录", parent_path: "" }, result: { path: "目录", name: "目录" } },
          update_folder: { args: { project_id: "proj_1", path: "目录/子目录", name: "新目录", parent_path: "" }, result: { path: "新目录", name: "新目录" } },
          delete_folder: { args: { project_id: "proj_1", path: "新目录" }, result: { deleted: true } },
          update_document: { args: { project_id: "proj_1", document_id: "doc_1", name: "新名称", relative_path: "文件.md", description: "" }, result: { id: "doc_1", name: "新名称", relative_path: "文件.md", description: "" } },
          delete_document: { args: { project_id: "proj_1", document_id: "doc_1" }, result: { deleted: true } },
          list_branches: { args: { project_id: "proj_1", document_id: "doc_1" }, result: [{ id: "branch_1", name: "dev", document_id: "doc_1" }] },
          get_document_section: { args: { project_id: "proj_1", document_id: "doc_1", commit_id: "a".repeat(64), kind: "openapi_operation", method: "GET", path: "/widgets/{id}" }, result: { content_kind: "derived_json", content: '{"path":"/widgets/{id}"}' } },
          search_documents: { args: { project_id: "proj_1", query: "原始", limit: 1 }, result: { matches: [{ commit_id: "a".repeat(64), snippet: "\ufeff原始\r\n" }] } },
          apply_document_patch: { args: { project_id: "proj_1", document_id: "doc_1", branch_id: "branch_1", expected_head_commit_id: "a".repeat(64), expected_generation: 7, idempotency_key: "patch-stdio-fixture", edits: [{ old_text: "原始\r\n", new_text: "完整\r\n" }] }, result: { id: "c".repeat(64) } },
          commit_changes: { args: {
            project_id: "proj_1", document_id: "doc_1", branch_id: "branch_1", expected_head_commit_id: "a".repeat(64),
            expected_generation: 7, idempotency_key: "request-fixture-1",
            changes: [{ operation: "upsert", document_id: "doc_1", relative_path: "empty.txt", name: "Empty", document_type: 3, content: "" }],
          }, result: { id: "b".repeat(64), parent_ids: ["a".repeat(64)] } },
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
