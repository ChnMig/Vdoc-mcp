import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import test from "node:test";

import { callVdocTool, listVdocTools } from "../dist/vdoc-rpc.js";
const packageInfo = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("listVdocTools forwards tools/list to backend", async (t) => {
  const server = await startServer(async ({ body, headers }, res) => {
    assert.equal(headers.authorization, "vdoc_test_token");
    assert.equal(headers["user-agent"], `vdoc-mcp/${packageInfo.version} (stdio)`);
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
  assert.deepEqual(JSON.parse(result), [{ id: "doc_1" }]);
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
  assert.equal(JSON.parse(result).content.length, content.length);
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

test("listVdocTools closes an oversized response before the backend finishes sending", async (t) => {
  for (const declaredLength of [true, false]) {
    await t.test(declaredLength ? "declared length" : "chunked body", async (t) => {
      let responseClosed;
      const closed = new Promise((resolve) => { responseClosed = resolve; });
      const server = await startServer(async (_request, res) => {
        res.once("close", responseClosed);
        if (declaredLength) res.setHeader("content-length", 16 * 1024 * 1024 + 1);
        res.flushHeaders();
        res.write(declaredLength ? "x" : "x".repeat(16 * 1024 * 1024 + 1));
        // Keep the response open so a completed body cannot hide a missing cancellation.
      });
      t.after(() => {
        server.closeAllConnections();
        server.close();
      });
      await assert.rejects(
        () => listVdocTools({ ...configFor(server), requestTimeoutMs: 5000 }),
        /response exceeds 16777216 bytes/,
      );
      let deadline;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            deadline = setTimeout(() => reject(new Error("oversized response connection remained open after rejection")), 1000);
          }),
        ]);
      } finally {
        clearTimeout(deadline);
      }
    });
  }
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

test("RPC cancellation and timeout have distinct errors and release signal listeners", async (t) => {
  let requests = 0;
  const server = await startServer(async ({ body }, res) => {
    requests += 1;
    if (body.params?.name === "complete") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }));
    }
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const cancelled = new AbortController();
  cancelled.abort(new Error("private cancellation reason"));
  await assert.rejects(
    () => callVdocTool(configFor(server), "fixture", {}, cancelled.signal),
    { message: "Vdoc MCP request cancelled." },
  );
  assert.equal(requests, 0);
  assert.equal(getEventListeners(cancelled.signal, "abort").length, 0);

  const active = new AbortController();
  assert.equal(await callVdocTool(configFor(server), "complete", {}, active.signal), "null");
  assert.equal(getEventListeners(active.signal, "abort").length, 0);
  await assert.rejects(
    () => callVdocTool({ ...configFor(server), requestTimeoutMs: 30 }, "fixture", {}, active.signal),
    /timed out after 30ms/,
  );
  assert.equal(getEventListeners(active.signal, "abort").length, 0);
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
