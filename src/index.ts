#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createVdocMCPServer } from "./mcp-server.js";
import { redactSecrets } from "./sanitize.js";
import { packageVersion } from "./version.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--version") {
    console.log(packageVersion);
    return;
  }
  if (args.length === 1 && args[0] === "--help") {
    console.log("vdoc-mcp: start the MCP stdio server (requires VDOC_BASE_URL or VDOC_MCP_URL, and VDOC_MCP_TOKEN).\nvdoc-mcp --version: print the adapter version.\nvdoc-mcp --help: show this help.");
    return;
  }
  if (args.length > 0) throw new Error("Unknown arguments. Run vdoc-mcp --help.");
  const config = loadConfig();
  const server = createVdocMCPServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(`[vdoc-mcp] ${redactSecrets(error)}`);
  process.exit(1);
});
