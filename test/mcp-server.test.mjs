import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createVdocMCPServer } from "../dist/mcp-server.js";

async function session(t, handler) {
  const backend = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    handler(JSON.parse(Buffer.concat(chunks).toString()), res);
  });
  await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
  const server = createVdocMCPServer({
    endpointUrl: `http://127.0.0.1:${backend.address().port}/api/v1/open/mcp`,
    token: "fixture-only",
    requestTimeoutMs: 5000,
  });
  const client = new Client({ name: "mcp-regression", version: "1" });
  t.after(async () => {
    await client.close();
    await server.close();
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return client;
}

for (const name of ["get_endpoint_detail", "compare_api_versions"]) {
  test(`MCP preserves exact backend ${name} JSON`, async t => {
    const fixture = process.env.VDOC_MCP_NUMERIC_FIXTURE_DIR
      ? join(process.env.VDOC_MCP_NUMERIC_FIXTURE_DIR, `${name}.json`)
      : new URL(`fixtures/${name}.json`, import.meta.url);
    const raw = readFileSync(fixture, "utf8");
    assert.match(raw, /9007199254740993/);
    if (name === "get_endpoint_detail") {
      assert.match(raw, /0\.123456789012345678901/);
      assert.match(raw, /1e400/);
    } else {
      assert.match(raw, /9007199254740992/);
    }
    const client = await session(t, (body, res) => {
      res.end(`{"jsonrpc":"2.0","id":${JSON.stringify(body.id)},"result":${raw}}`);
    });
    const result = await client.callTool({ name, arguments: {} });
    assert.notEqual(result.isError, true);
    assert.equal(result.content[0].text, raw.trim());
  });
}

test("raw result extraction handles nesting, escaped keys, strings and primitives", async t => {
  const values = [
    '9007199254740993', '1e400', '-0', 'null', 'true',
    JSON.stringify('string with "result":1e400, \\ and {braces} [brackets]'),
    '{"result":{"result":[9007199254740993,0.123456789012345678901]},"id":"nested"}',
    '[[],{},"",false,1e400]',
  ];
  for (const raw of values) {
    await t.test(raw, async t => {
      const client = await session(t, (body, res) => {
        // The escaped top-level key must select the last result, like JSON.parse.
        res.end(` {"result":0,"nested":{"result":1},"jsonrpc":"2.0","re\\u0073ult": ${raw} ,"id":${JSON.stringify(body.id)}} `);
      });
      const result = await client.callTool({ name: "fixture", arguments: {} });
      assert.notEqual(result.isError, true);
      assert.equal(result.content[0].text, raw);
    });
  }
});

test("raw responses still validate envelopes and redact errors", async t => {
  const cases = [
    [() => '{"result":1e400', /invalid JSON/],
    [id => `{"jsonrpc":"1.0","id":${id},"result":1}`, /invalid JSON-RPC envelope/],
    [() => '{"jsonrpc":"2.0","id":"wrong","result":1}', /mismatched JSON-RPC id/],
    [id => `{"jsonrpc":"2.0","id":${id},"result":1,"error":{"message":"error"}}`, /exactly one/],
    [id => `{"jsonrpc":"2.0","id":${id},"error":{"message":"Authorization: Bearer abc.def.ghi"}}`, /\[redacted\]/],
  ];
  for (const [response, expected] of cases) {
    await t.test(String(expected), async t => {
      const client = await session(t, (body, res) => res.end(response(JSON.stringify(body.id))));
      const result = await client.callTool({ name: "fixture", arguments: {} });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, expected);
      assert.doesNotMatch(result.content[0].text, /abc\.def\.ghi/);
    });
  }
});

for (const method of ["tools/list", "tools/call"]) {
  for (const streaming of [false, true]) {
    test(`${method} cancellation closes HTTP ${streaming ? "during body streaming" : "before headers"}`, { timeout: 5000 }, async t => {
      let receivedResolve, closedResolve;
      const received = new Promise(resolve => { receivedResolve = resolve; });
      const closed = new Promise(resolve => { closedResolve = resolve; });
      const client = await session(t, (body, res) => {
        assert.equal(body.method, method);
        res.once("close", closedResolve);
        if (streaming) res.write('{"jsonrpc":"2.0","result":');
        receivedResolve();
      });
      const controller = new AbortController();
      const request = method === "tools/list"
        ? client.listTools({}, { signal: controller.signal })
        : client.callTool({ name: "fixture", arguments: {} }, undefined, { signal: controller.signal });
      const rejected = assert.rejects(request, /cancel fixture/);
      await received;
      controller.abort(new Error("cancel fixture"));
      await rejected;
      let timeout;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("cancelled HTTP request remained open")), 1000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    });
  }
}
