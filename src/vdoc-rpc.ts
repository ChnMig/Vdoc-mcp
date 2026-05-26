import { randomUUID } from "node:crypto";

import type { VdocMCPConfig } from "./config.js";
import { redactSecrets } from "./sanitize.js";

export interface VdocToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

interface JSONRPCSuccess {
  jsonrpc: "2.0";
  id: string;
  result: unknown;
}

interface JSONRPCFailure {
  jsonrpc: "2.0";
  id: string;
  error: JSONRPCErrorPayload;
}

type JSONRPCResponse = JSONRPCSuccess | JSONRPCFailure;

interface JSONRPCErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

export class VdocRPCError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(redactSecrets(message));
    this.name = "VdocRPCError";
  }
}

export async function listVdocTools(config: VdocMCPConfig): Promise<VdocToolDefinition[]> {
  const result = await callVdocRPC(config, "tools/list");
  if (!isObject(result) || !Array.isArray(result.tools)) {
    throw new VdocRPCError("Vdoc tools/list returned an invalid result shape.");
  }
  return result.tools.map(toToolDefinition);
}

export async function callVdocTool(
  config: VdocMCPConfig,
  name: string,
  args: unknown,
): Promise<unknown> {
  return callVdocRPC(config, "tools/call", {
    name,
    arguments: isObject(args) ? args : {},
  });
}

async function callVdocRPC(
  config: VdocMCPConfig,
  method: "tools/list" | "tools/call",
  params?: unknown,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const id = `vdoc-mcp-${randomUUID()}`;

  try {
    const response = await fetch(config.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: config.token,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    if (!response.ok) {
      throw new VdocRPCError(`Vdoc MCP HTTP ${response.status}: ${bodyText}`);
    }

    const payload = parseResponse(bodyText, id);
    if ("error" in payload) {
      throw new VdocRPCError(formatRPCErrorMessage(payload.error), payload.error.code, payload.error.data);
    }
    return payload.result;
  } catch (error) {
    if (error instanceof VdocRPCError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new VdocRPCError(`Vdoc MCP request timed out after ${config.requestTimeoutMs}ms.`);
    }
    throw new VdocRPCError(redactSecrets(error));
  } finally {
    clearTimeout(timeout);
  }
}

function parseResponse(bodyText: string, expectedId: string): JSONRPCResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new VdocRPCError(`Vdoc MCP returned invalid JSON: ${redactSecrets(error)}`);
  }

  if (!isObject(parsed) || parsed.jsonrpc !== "2.0") {
    throw new VdocRPCError("Vdoc MCP returned an invalid JSON-RPC envelope.");
  }
  if (parsed.id !== expectedId) {
    throw new VdocRPCError("Vdoc MCP returned a mismatched JSON-RPC id.");
  }

  const hasError = hasOwn(parsed, "error");
  const hasResult = hasOwn(parsed, "result");
  if (hasError === hasResult) {
    throw new VdocRPCError("Vdoc MCP JSON-RPC response must include exactly one of result or error.");
  }

  if (hasError) {
    const error = parsed.error;
    if (!isObject(error) || typeof error.message !== "string") {
      throw new VdocRPCError("Vdoc MCP returned an invalid JSON-RPC error.");
    }
    return {
      jsonrpc: "2.0",
      id: expectedId,
      error: {
        code: typeof error.code === "number" ? error.code : -32000,
        message: error.message,
        data: error.data,
      },
    };
  }

  return { jsonrpc: "2.0", id: expectedId, result: parsed.result };
}

function toToolDefinition(value: unknown): VdocToolDefinition {
  if (!isObject(value) || typeof value.name !== "string" || !isObject(value.inputSchema)) {
    throw new VdocRPCError("Vdoc tools/list returned an invalid tool definition.");
  }
  return {
    name: value.name,
    description: typeof value.description === "string" ? value.description : undefined,
    inputSchema: value.inputSchema,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function formatRPCErrorMessage(error: JSONRPCErrorPayload): string {
  const detail = rpcErrorDetail(error.data);
  if (detail === "") {
    return error.message;
  }
  return `${error.message}: ${detail}`;
}

function rpcErrorDetail(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (isObject(data) && typeof data.detail === "string") {
    return data.detail;
  }
  return "";
}
