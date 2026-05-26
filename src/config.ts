export interface VdocMCPConfig {
  endpointUrl: string;
  token: string;
  requestTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VdocMCPConfig {
  const endpointUrl = resolveEndpointUrl(env);
  const token = requireEnv(env, "VDOC_MCP_TOKEN");
  const requestTimeoutMs = parseTimeout(env.VDOC_MCP_TIMEOUT_MS);

  return { endpointUrl, token, requestTimeoutMs };
}

function resolveEndpointUrl(env: NodeJS.ProcessEnv): string {
  const explicitUrl = trim(env.VDOC_MCP_URL);
  if (explicitUrl !== "") {
    return normalizeUrl(explicitUrl, "VDOC_MCP_URL");
  }

  const baseUrl = trim(env.VDOC_BASE_URL);
  if (baseUrl === "") {
    throw new Error("Set VDOC_MCP_URL or VDOC_BASE_URL before starting vdoc-mcp.");
  }

  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/api/v1/open/mcp`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = trim(env[key]);
  if (value === "") {
    throw new Error(`Set ${key} before starting vdoc-mcp.`);
  }
  return value;
}

function parseTimeout(raw: string | undefined): number {
  const value = trim(raw);
  if (value === "") {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("VDOC_MCP_TIMEOUT_MS must be a positive integer.");
  }
  return parsed;
}

function normalizeUrl(raw: string, key: string): string {
  try {
    return new URL(raw).toString();
  } catch {
    throw new Error(`${key} must be a valid URL.`);
  }
}

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}
