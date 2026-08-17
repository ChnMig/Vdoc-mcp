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

// A valid OpenAPI upload may be 5 MiB before the JSON-RPC envelope and JSON
// escaping are added. Keep a bounded streaming limit with enough headroom for
// that supported payload instead of rejecting it at the adapter boundary.
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_HTTP_ERROR_CHARACTERS = 4096;

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
      redirect: "error",
      signal: controller.signal,
    });

    const bodyText = await readResponseText(response);
    if (!response.ok) {
      throw new VdocRPCError(`Vdoc MCP HTTP ${response.status}: ${httpErrorPreview(bodyText)}`);
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

async function readResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new VdocRPCError(`Vdoc MCP response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
  }
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      parts.push(decoder.decode());
      return parts.join("");
    }
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new VdocRPCError(`Vdoc MCP response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
    }
    parts.push(decoder.decode(value, { stream: true }));
  }
}

function httpErrorPreview(body: string): string {
  if (body.length <= MAX_HTTP_ERROR_CHARACTERS) {
    return body;
  }
  return `${body.slice(0, MAX_HTTP_ERROR_CHARACTERS)}…[truncated]`;
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
