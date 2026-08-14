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
    /valid HTTP\(S\) URL/,
  );
});

test("loadConfig rejects invalid timeout", () => {
  assert.throws(
    () => loadConfig({ VDOC_BASE_URL: "https://vdoc.example.com", VDOC_MCP_TOKEN: "vdoc_test_token", VDOC_MCP_TIMEOUT_MS: "0" }),
    /between 1 and 120000/,
  );
});

test("loadConfig rejects remote plaintext and credential-bearing URLs", () => {
  for (const endpoint of [
    "http://vdoc.example.com/api/v1/open/mcp",
    "https://user:pass@vdoc.example.com/api/v1/open/mcp",
    "https://vdoc.example.com/api/v1/open/mcp?token=leak",
  ]) {
    assert.throws(
      () => loadConfig({ VDOC_MCP_URL: endpoint, VDOC_MCP_TOKEN: "vdoc_test_token" }),
      /HTTPS|credentials|query/,
    );
  }
});

test("loadConfig allows HTTP only for local development", () => {
  for (const endpoint of [
    "http://localhost:8080/api/v1/open/mcp",
    "http://dev.localhost:8080/api/v1/open/mcp",
    "http://127.0.0.1:8080/api/v1/open/mcp",
    "http://[::1]:8080/api/v1/open/mcp",
  ]) {
    assert.equal(
      loadConfig({ VDOC_MCP_URL: endpoint, VDOC_MCP_TOKEN: "vdoc_test_token" }).endpointUrl,
      endpoint,
    );
  }
});

test("loadConfig rejects timeouts that overflow the supported request window", () => {
  assert.throws(
    () => loadConfig({
      VDOC_BASE_URL: "https://vdoc.example.com",
      VDOC_MCP_TOKEN: "vdoc_test_token",
      VDOC_MCP_TIMEOUT_MS: "120001",
    }),
    /between 1 and 120000/,
  );
});
