import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { callVdocTool, listVdocTools } from "../dist/vdoc-rpc.js";

test("listVdocTools forwards tools/list to backend", async (t) => {
  const server = await startServer(async ({ body, headers }, res) => {
    assert.equal(headers.authorization, "vdoc_test_token");
    assert.equal(headers["user-agent"], "vdoc-mcp/0.1.0 (stdio)");
    assert.equal(headers["x-vdoc-adapter"], "stdio");
    assert.equal(body.method, "tools/list");
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      result: {
        tools: [{ name: "list_projects", description: "List projects", inputSchema: { type: "object" } }],
      },
    }));
  });
  t.after(() => server.close());

  const tools = await listVdocTools(configFor(server));
  assert.deepEqual(tools, [{ name: "list_projects", description: "List projects", inputSchema: { type: "object" } }]);
});

test("callVdocTool forwards tools/call arguments to backend", async (t) => {
  const server = await startServer(async ({ body }, res) => {
    assert.equal(body.method, "tools/call");
    assert.deepEqual(body.params, { name: "list_documents", arguments: { project_id: "proj_1" } });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: [{ id: "doc_1" }] }));
  });
  t.after(() => server.close());

  const result = await callVdocTool(configFor(server), "list_documents", { project_id: "proj_1" });
  assert.deepEqual(result, [{ id: "doc_1" }]);
});

test("callVdocTool includes backend JSON-RPC error detail", async (t) => {
  const server = await startServer(async ({ body }, res) => {
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32602, message: "invalid params", data: { detail: "project_id is required" } },
    }));
  });
  t.after(() => server.close());

  await assert.rejects(
    () => callVdocTool(configFor(server), "list_documents", {}),
    /invalid params: project_id is required/,
  );
});

test("callVdocTool redacts HTTP error bodies", async (t) => {
  const server = await startServer(async (_request, res) => {
    res.statusCode = 500;
    res.end("Authorization: Bearer abc.def.ghi");
  });
  t.after(() => server.close());

  await assert.rejects(
    () => callVdocTool(configFor(server), "list_projects", {}),
    (error) => {
      assert.match(error.message, /Authorization: \[redacted\]/);
      assert.doesNotMatch(error.message, /abc\.def\.ghi/);
      return true;
    },
  );
});

test("listVdocTools rejects malformed JSON", async (t) => {
  const server = await startServer(async (_request, res) => {
    res.end("not json");
  });
  t.after(() => server.close());

  await assert.rejects(() => listVdocTools(configFor(server)), /invalid JSON/);
});

test("listVdocTools rejects mismatched JSON-RPC id", async (t) => {
  const server = await startServer(async (_request, res) => {
    res.end(JSON.stringify({ jsonrpc: "2.0", id: "wrong-id", result: { tools: [] } }));
  });
  t.after(() => server.close());

  await assert.rejects(() => listVdocTools(configFor(server)), /mismatched JSON-RPC id/);
});

test("listVdocTools rejects missing JSON-RPC result", async (t) => {
  const server = await startServer(async ({ body }, res) => {
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id }));
  });
  t.after(() => server.close());

  await assert.rejects(() => listVdocTools(configFor(server)), /exactly one of result or error/);
});

test("callVdocTool accepts a supported 5 MiB document response", async (t) => {
  const content = "x".repeat(5 * 1024 * 1024 + 1);
  const server = await startServer(async ({ body }, res) => {
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content } }));
  });
  t.after(() => server.close());

  const result = await callVdocTool({ ...configFor(server), requestTimeoutMs: 5000 }, "get_latest_schema", {});
  assert.equal(result.content.length, content.length);
});

test("listVdocTools rejects oversized backend responses", async (t) => {
  const server = await startServer(async (_request, res) => {
    res.end("x".repeat(16 * 1024 * 1024 + 1));
  });
  t.after(() => server.close());

  await assert.rejects(
    () => listVdocTools({ ...configFor(server), requestTimeoutMs: 5000 }),
    /response exceeds 16777216 bytes/,
  );
});

test("listVdocTools refuses redirects before contacting the target", async (t) => {
  let targetCalls = 0;
  const target = await startServer(async ({ body }, res) => {
    targetCalls += 1;
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }));
  });
  t.after(() => target.close());
  const targetAddress = target.address();
  const source = await startServer(async (_request, res) => {
    res.statusCode = 307;
    res.setHeader("location", `http://127.0.0.1:${targetAddress.port}/api/v1/open/mcp`);
    res.end();
  });
  t.after(() => source.close());

  await assert.rejects(() => listVdocTools(configFor(source)), /fetch|redirect/i);
  assert.equal(targetCalls, 0);
});

function configFor(server) {
  const address = server.address();
  return {
    endpointUrl: `http://127.0.0.1:${address.port}/api/v1/open/mcp`,
    token: "vdoc_test_token",
    requestTimeoutMs: 1000,
  };
}

async function startServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      res.setHeader("content-type", "application/json");
      await handler({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")), headers: req.headers }, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}
