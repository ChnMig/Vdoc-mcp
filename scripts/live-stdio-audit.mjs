import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const allowedMetadataKeys = new Set([
  "adapter",
  "evidence_kind",
  "result",
  "tool_name",
  "token_id",
  "reason",
  "project_id",
  "document_id",
  "branch_id",
  "draft_id",
  "version_id",
  "endpoint_id",
  "from_version_id",
  "to_version_id",
  "diff_id",
]);
const secrets = new Set();

const baseUrl = localBaseUrl(process.env.VDOC_LIVE_AUDIT_BASE_URL ?? "http://127.0.0.1:8080");
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const password = `Vdoc-${randomBytes(18).toString("base64url")}`;
secrets.add(password);

let jwt = "";
let projectId = "";
let mcpTokenId = "";
let mcpToken = "";
let client;
let tokenRevoked = false;
let projectArchived = false;

try {
  assert(
    process.env.VDOC_LIVE_AUDIT_EMPTY_DATABASE_CONFIRM === "1",
    "set VDOC_LIVE_AUDIT_EMPTY_DATABASE_CONFIRM=1 only after confirming the target uses an empty disposable application database",
  );
  const authConfig = await api("/api/v1/open/auth/config");
  assert(authConfig.registration_enabled === true, "live audit requires registration on a trusted local stack");

  const registration = await api("/api/v1/open/auth/register", {
    method: "POST",
    body: {
      email: `stdio-audit-${Date.now()}-${runId}@example.test`,
      name: "Stdio Audit",
      password,
    },
  });
  const userId = canonicalId(registration?.user?.id, "registered user id");
  assert(
    registration?.user?.is_super_admin === true,
    "live audit requires an empty disposable application database so the registered user becomes SuperAdmin",
  );
  jwt = requiredString(registration?.token, "registration JWT");
  secrets.add(jwt);

  const team = await api("/api/v1/private/teams", {
    method: "POST",
    jwt,
    body: { name: `Stdio Audit ${runId}`, description: "Disposable deployed MCP audit" },
  });
  const teamId = canonicalId(team?.id, "team id");

  const project = await api("/api/v1/private/projects", {
    method: "POST",
    jwt,
    body: {
      team_id: teamId,
      name: `Stdio Audit ${runId}`,
      description: "Disposable deployed MCP audit",
      admin_user_id: userId,
    },
  });
  projectId = canonicalId(project?.id, "project id");

  const document = await api(`/api/v1/private/projects/${projectId}/documents`, {
    method: "POST",
    jwt,
    body: {
      name: `stdio-audit-${runId}`,
      document_type: 1,
      relative_path: `audit/${runId}.json`,
      description: "Disposable deployed MCP audit",
    },
  });
  const documentId = canonicalId(document?.id, "document id");

  const branches = await api(
    `/api/v1/private/projects/${projectId}/documents/${documentId}/branches`,
    { jwt },
  );
  assert(Array.isArray(branches), "branch list must be an array");
  const branchId = canonicalId(
    branches.find((branch) => branch?.name === "dev")?.id,
    "dev branch id",
  );

  const schemaContent = JSON.stringify({
    openapi: "3.0.3",
    info: { title: "Live stdio audit", version: "1.0.0" },
    paths: {
      "/audit/pets": {
        get: {
          operationId: "listAuditPets",
          responses: { 200: { description: "Audit response" } },
        },
      },
    },
  });
  const draft = await api(
    `/api/v1/private/projects/${projectId}/documents/${documentId}/drafts`,
    {
      method: "POST",
      jwt,
      body: { branch_id: branchId, version_name: "1.0.0", schema_content: schemaContent },
    },
  );
  const draftId = canonicalId(draft?.id, "draft id");
  await api(
    `/api/v1/private/projects/${projectId}/documents/${documentId}/drafts/${draftId}/submit`,
    { method: "POST", jwt },
  );
  const version = await api(
    `/api/v1/private/projects/${projectId}/documents/${documentId}/drafts/${draftId}/approve`,
    { method: "POST", jwt },
  );
  const versionId = canonicalId(version?.id, "version id");

  const endpoints = await api(
    `/api/v1/private/projects/${projectId}/documents/${documentId}/versions/${versionId}/endpoints?path=%2Faudit%2Fpets`,
    { jwt },
  );
  assert(Array.isArray(endpoints), "endpoint list must be an array");
  const endpointId = canonicalId(endpoints[0]?.id, "endpoint id");

  const token = await api("/api/v1/private/mcp-tokens", {
    method: "POST",
    jwt,
    body: { name: `stdio-audit-${runId}`, scopes: [1] },
  });
  mcpTokenId = canonicalId(token?.id, "MCP token id");
  mcpToken = requiredString(token?.token, "MCP token secret");
  secrets.add(mcpToken);

  client = new Client({ name: "vdoc-live-stdio-audit", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: {
      VDOC_MCP_URL: `${baseUrl}/api/v1/open/mcp`,
      VDOC_MCP_TOKEN: mcpToken,
      VDOC_MCP_TIMEOUT_MS: "30000",
    },
  });
  await client.connect(transport);

  const toolList = await client.listTools();
  assert(
    toolList.tools.some((tool) => tool.name === "get_endpoint_detail"),
    "stdio tools/list must expose get_endpoint_detail",
  );
  const toolResult = await client.callTool({
    name: "get_endpoint_detail",
    arguments: {
      project_id: projectId,
      document_id: documentId,
      version_id: versionId,
      endpoint_id: endpointId,
    },
  });
  assert(toolResult.isError !== true, "stdio get_endpoint_detail returned an MCP error");
  const textContent = toolResult.content.find((item) => item.type === "text");
  assert(textContent && typeof textContent.text === "string", "stdio tool result must contain text");
  const endpoint = JSON.parse(textContent.text);
  assert(endpoint?.id === endpointId, "stdio endpoint detail must match the requested endpoint");

  await client.close();
  client = undefined;

  const usageResponse = await apiEnvelope(
    `/api/v1/private/mcp-usage?token_id=${mcpTokenId}&limit=20`,
    { jwt },
  );
  const usage = usageResponse.envelope.detail;
  assert(Array.isArray(usage), "MCP usage detail must be an array");
  assert(usage.length === 2, `new MCP token must have exactly two usage rows, got ${usage.length}`);

  const usageByTool = new Map();
  for (const row of usage) {
    assert(row?.action === "mcp.tool_call", "usage action must be mcp.tool_call");
    assert(row?.actor_token_id === mcpTokenId, "usage actor token must match the created token");
    assert(row?.metadata && typeof row.metadata === "object", "usage metadata must be an object");
    for (const key of Object.keys(row.metadata)) {
      assert(allowedMetadataKeys.has(key), `usage metadata key is not allowlisted: ${key}`);
    }
    assert(row.metadata.adapter === "stdio", "usage adapter must be stdio");
    assert(row.metadata.result === "success", "usage result must be success");
    assert(row.metadata.token_id === mcpTokenId, "usage metadata token must be exact");
    usageByTool.set(row.metadata.tool_name, row);
  }

  const capabilityUsage = requiredUsage(usageByTool, "tools/list", "capability_list");
  assert(!capabilityUsage.project_id && !capabilityUsage.document_id, "tools/list must not claim entity IDs");

  const endpointUsage = requiredUsage(
    usageByTool,
    "get_endpoint_detail",
    "published_content_read",
  );
  assert(endpointUsage.project_id === projectId, "usage project id must be exact");
  assert(endpointUsage.document_id === documentId, "usage document id must be exact");
  assert(endpointUsage.metadata.project_id === projectId, "metadata project id must be exact");
  assert(endpointUsage.metadata.document_id === documentId, "metadata document id must be exact");
  assert(endpointUsage.metadata.version_id === versionId, "metadata version id must be exact");
  assert(endpointUsage.metadata.endpoint_id === endpointId, "metadata endpoint id must be exact");

  for (const forbidden of [
    ...secrets,
    schemaContent,
    "schema_content",
    "markdown_content",
    "listAuditPets",
    "/audit/pets",
    '"ip_address"',
    '"user_agent"',
    "vdoc-mcp/0.1.0 (stdio)",
  ]) {
    assert(!usageResponse.raw.includes(forbidden), `usage response leaked forbidden value: ${label(forbidden)}`);
  }

  await api(`/api/v1/private/mcp-tokens/${mcpTokenId}/revoke`, { method: "POST", jwt });
  tokenRevoked = true;
  await api(`/api/v1/private/projects/${projectId}/archive`, { method: "POST", jwt });
  projectArchived = true;

  console.log(
    JSON.stringify(
      {
        status: "pass",
        target: baseUrl,
        adapter: endpointUsage.metadata.adapter,
        evidence_kind: endpointUsage.metadata.evidence_kind,
        usage_events: usage.length,
        tool_count: toolList.tools.length,
        ids: { project_id: projectId, document_id: documentId, version_id: versionId, endpoint_id: endpointId },
        redaction: "secret/schema/content/ip/user-agent absent",
        cleanup: "MCP token revoked; project archived",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`live stdio audit failed: ${sanitize(error)}`);
  process.exitCode = 1;
} finally {
  if (client) {
    await client.close().catch(() => undefined);
  }
  if (jwt && mcpTokenId && !tokenRevoked) {
    await api(`/api/v1/private/mcp-tokens/${mcpTokenId}/revoke`, { method: "POST", jwt }).catch(
      () => undefined,
    );
  }
  if (jwt && projectId && !projectArchived) {
    await api(`/api/v1/private/projects/${projectId}/archive`, { method: "POST", jwt }).catch(
      () => undefined,
    );
  }
}

async function api(path, options = {}) {
  return (await apiEnvelope(path, options)).envelope.detail;
}

async function apiEnvelope(path, { method = "GET", jwt: authToken = "", body } = {}) {
  const headers = { accept: "application/json" };
  if (authToken) headers.authorization = authToken;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
  });
  const raw = await response.text();
  assert(response.ok, `HTTP ${response.status} for ${method} ${path.split("?")[0]}`);
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error(`invalid JSON for ${method} ${path.split("?")[0]}`);
  }
  assert(
    envelope?.code === 200 && envelope?.status === "OK",
    `API ${envelope?.code ?? "unknown"} ${envelope?.status ?? "unknown"} for ${method} ${path.split("?")[0]}`,
  );
  return { envelope, raw };
}

function requiredUsage(usageByTool, toolName, evidenceKind) {
  const row = usageByTool.get(toolName);
  assert(row, `missing usage evidence for ${toolName}`);
  assert(row.metadata.evidence_kind === evidenceKind, `${toolName} evidence_kind must be ${evidenceKind}`);
  return row;
}

function canonicalId(value, description) {
  const text = requiredString(value, description);
  assert(/^[0-9a-f]{32}$/.test(text), `${description} must be a canonical Vdoc id`);
  return text;
}

function requiredString(value, description) {
  assert(typeof value === "string" && value.length > 0, `${description} must be present`);
  return value;
}

function localBaseUrl(raw) {
  const url = new URL(raw);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  assert(
    (url.protocol === "http:" || url.protocol === "https:") &&
      (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "",
    "VDOC_LIVE_AUDIT_BASE_URL must be a credential-free loopback HTTP(S) URL",
  );
  return url.toString().replace(/\/+$/, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function label(value) {
  if (secrets.has(value)) return "[secret]";
  if (value.length > 80) return `${value.slice(0, 24)}…`;
  return value;
}

function sanitize(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secrets) message = message.replaceAll(secret, "[REDACTED]");
  return message;
}
