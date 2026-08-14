export interface VdocMCPConfig {
  endpointUrl: string;
  token: string;
  requestTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): VdocMCPConfig {
  const endpointUrl = resolveEndpointUrl(env);
  const token = requireEnv(env, "VDOC_MCP_TOKEN");
  const requestTimeoutMs = parseTimeout(env.VDOC_MCP_TIMEOUT_MS);

  return { endpointUrl, token, requestTimeoutMs };
}

function resolveEndpointUrl(env: NodeJS.ProcessEnv): string {
  const explicitUrl = trim(env.VDOC_MCP_URL);
  if (explicitUrl !== "") {
    return validateEndpointUrl(explicitUrl, "VDOC_MCP_URL").toString();
  }

  const baseUrl = trim(env.VDOC_BASE_URL);
  if (baseUrl === "") {
    throw new Error("Set VDOC_MCP_URL or VDOC_BASE_URL before starting vdoc-mcp.");
  }

  const url = validateEndpointUrl(baseUrl, "VDOC_BASE_URL");
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
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`VDOC_MCP_TIMEOUT_MS must be an integer between 1 and ${MAX_TIMEOUT_MS}.`);
  }
  return parsed;
}

function validateEndpointUrl(raw: string, key: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) URL.`);
  }

  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`${key} must be an HTTP(S) URL without credentials, query, or fragment.`);
  }
  if (url.protocol === "http:" && !isLocalDevelopmentHost(url.hostname)) {
    throw new Error(`${key} must use HTTPS except for localhost or loopback development.`);
  }
  return url;
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}
