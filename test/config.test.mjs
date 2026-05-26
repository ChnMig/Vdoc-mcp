import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../dist/config.js";

test("loadConfig uses explicit MCP URL", () => {
  const config = loadConfig({
    VDOC_MCP_URL: "https://vdoc.example.com/api/v1/open/mcp",
    VDOC_MCP_TOKEN: "vdoc_test_token",
  });

  assert.equal(config.endpointUrl, "https://vdoc.example.com/api/v1/open/mcp");
  assert.equal(config.token, "vdoc_test_token");
  assert.equal(config.requestTimeoutMs, 30000);
});

test("loadConfig derives MCP URL from base URL", () => {
  const config = loadConfig({
    VDOC_BASE_URL: "https://vdoc.example.com/app/",
    VDOC_MCP_TOKEN: "vdoc_test_token",
    VDOC_MCP_TIMEOUT_MS: "1000",
  });

  assert.equal(config.endpointUrl, "https://vdoc.example.com/app/api/v1/open/mcp");
  assert.equal(config.requestTimeoutMs, 1000);
});

test("loadConfig requires token", () => {
  assert.throws(
    () => loadConfig({ VDOC_BASE_URL: "https://vdoc.example.com" }),
    /VDOC_MCP_TOKEN/,
  );
});

test("loadConfig rejects invalid base URL", () => {
  assert.throws(
    () => loadConfig({ VDOC_BASE_URL: "not a url", VDOC_MCP_TOKEN: "vdoc_test_token" }),
    /Invalid URL/,
  );
});

test("loadConfig rejects invalid timeout", () => {
  assert.throws(
    () => loadConfig({ VDOC_BASE_URL: "https://vdoc.example.com", VDOC_MCP_TOKEN: "vdoc_test_token", VDOC_MCP_TIMEOUT_MS: "0" }),
    /positive integer/,
  );
});
