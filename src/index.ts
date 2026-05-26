#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createVdocMCPServer } from "./mcp-server.js";
import { redactSecrets } from "./sanitize.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const server = createVdocMCPServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(`[vdoc-mcp] ${redactSecrets(error)}`);
  process.exit(1);
});
