import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const packageInfo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const contract = JSON.parse(readFileSync(join(root, "references/mcp-tools.json"), "utf8"));
const schemas = new Map(contract.tools.map((tool) => [tool.name, tool]));
const markdownFiles = ["SKILL.md", "README.md", ...["templates", "examples", "references", "evals"].flatMap((dir) =>
  readdirSync(join(root, dir)).filter((name) => name.endsWith(".md")).map((name) => `${dir}/${name}`)
)];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function isPackaged(path) {
  return packageInfo.files.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

test("tool inventory and argument contract are consistent", () => {
  assert.equal(schemas.size, contract.tools.length, "duplicate tool names");
  const inventory = read("SKILL.md").split("<!-- VDOC_MCP_TOOL_INVENTORY_START -->")[1]
    .split("<!-- VDOC_MCP_TOOL_INVENTORY_END -->")[0];
  const names = inventory.split("\n").filter((line) => /^[a-z][a-z0-9_]+$/.test(line));
  assert.deepEqual(names.sort(), [...schemas.keys()].sort());
  for (const tool of schemas.values()) {
    assert.match(tool.name, /^[a-z][a-z0-9_]+$/);
    assert.ok(!tool.name.startsWith("publish_") && tool.name !== "approve_draft", "MCP cannot publish");
    assert.equal(new Set([...tool.required, ...tool.optional]).size, tool.required.length + tool.optional.length);
    assert.ok(tool.scopes_any.length > 0);
  }
});

test("protocol examples use supported tools and valid argument fields", () => {
  let count = 0;
  for (const path of markdownFiles) {
    for (const match of read(path).matchAll(/```json\s*([\s\S]*?)```/g)) {
      const payload = JSON.parse(match[1]);
      assert.equal(payload.jsonrpc, "2.0", path);
      assert.ok(payload.id, `${path}: examples need a request id`);
      if (payload.method === "tools/list") continue;
      assert.equal(payload.method, "tools/call", path);
      const schema = schemas.get(payload.params?.name);
      assert.ok(schema, `${path}: unknown tool ${payload.params?.name}`);
      const args = payload.params.arguments;
      assert.ok(args && typeof args === "object" && !Array.isArray(args));
      for (const key of schema.required) {
        assert.equal(typeof args[key], "string", `${path}: missing ${key}`);
        assert.ok(args[key].trim(), `${path}: empty ${key}`);
      }
      for (const [key, value] of Object.entries(args)) {
        assert.ok([...schema.required, ...schema.optional].includes(key), `${path}: unsupported ${key}`);
        assert.equal(typeof value, "string", `${path}: ${key} must be a string`);
      }
      count += 1;
    }
  }
  assert.ok(count > 0, "no executable payload examples found");
});

test("all local guidance links resolve inside the distributable package", () => {
  for (const path of markdownFiles) {
    assert.ok(isPackaged(path), `${path} is omitted from npm packaging`);
    for (const [, target] of read(path).matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(target)) continue;
      const resolved = resolve(root, dirname(path), target.split("#")[0]);
      const local = relative(root, resolved);
      assert.ok(!local.startsWith("..") && existsSync(resolved), `${path}: invalid local link ${target}`);
      assert.ok(isPackaged(local), `${path}: link points outside the package: ${target}`);
    }
  }
});

test("guidance and examples do not embed connection secrets", () => {
  for (const path of markdownFiles.filter((path) => path !== "README.md")) {
    const body = read(path);
    assert.doesNotMatch(body, /vdoc_[A-Za-z0-9._~+/=-]{8,}/, path);
    assert.doesNotMatch(body, /Authorization\s*:/i, path);
  }
});
