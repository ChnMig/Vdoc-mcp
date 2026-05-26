import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

import type { VdocMCPConfig } from "./config.js";
import { redactSecrets } from "./sanitize.js";
import { callVdocTool, listVdocTools } from "./vdoc-rpc.js";

export function createVdocMCPServer(config: VdocMCPConfig): Server {
  const server = new Server(
    { name: "vdoc", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await listVdocTools(config),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    try {
      const result = await callVdocTool(
        config,
        request.params.name,
        request.params.arguments ?? {},
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: redactSecrets(error) }],
      };
    }
  });

  return server;
}
