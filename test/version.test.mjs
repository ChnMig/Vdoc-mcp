import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("a packaged adapter reports its package version after a version bump", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "vdoc-mcp-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(new URL("../dist/", import.meta.url), join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", version: "9.8.7-rc.1" }));
  const { packageVersion } = await import(pathToFileURL(join(root, "dist/version.js")).href);
  assert.equal(packageVersion, "9.8.7-rc.1");
  const { listVdocTools } = await import(pathToFileURL(join(root, "dist/vdoc-rpc.js")).href);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests += 1;
    assert.equal(new Headers(options.headers).get("user-agent"), "vdoc-mcp/9.8.7-rc.1 (stdio)");
    const request = JSON.parse(options.body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }));
  });
  await listVdocTools({ endpointUrl: "https://api.example.test/api/v1/open/mcp", token: "fixture-token", requestTimeoutMs: 1000 });
  assert.equal(requests, 1);
});
