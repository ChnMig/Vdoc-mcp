import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const root = join(packageRoot, "skills/vdoc");
const packageInfo = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const contract = JSON.parse(readFileSync(join(root, "references/mcp-tools.json"), "utf8"));
const schemas = new Map(contract.tools.map((tool) => [tool.name, tool]));
const markdownFiles = ["SKILL.md", "README.md", ...["templates", "examples", "references", "evals"].flatMap((dir) =>
  readdirSync(join(root, dir)).filter((name) => name.endsWith(".md")).map((name) => `${dir}/${name}`)
)];

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function isPackaged(path) {
  const packagedPath = `skills/vdoc/${path}`;
  return packageInfo.files.some((entry) => packagedPath === entry || packagedPath.startsWith(`${entry}/`));
}

function validateValue(value, schema, path) {
  switch (schema.type) {
    case "string": assert.equal(typeof value, "string", `${path} must be a string`); break;
    case "integer":
      assert.ok(Number.isSafeInteger(value), `${path} must be a safe integer`);
      if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, `${path} is below its minimum`);
      break;
    case "array":
      assert.ok(Array.isArray(value), `${path} must be an array`);
      if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, `${path} has too few entries`);
      if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, `${path} has too many entries`);
      for (const [index, item] of value.entries()) validateValue(item, schema.items, `${path}[${index}]`);
      break;
    case "object":
      assert.ok(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
      for (const key of schema.required ?? []) assert.ok(Object.hasOwn(value, key), `${path}: missing ${key}`);
      for (const [key, item] of Object.entries(value)) {
        assert.ok(Object.hasOwn(schema.properties, key), `${path}: unsupported ${key}`);
        validateValue(item, schema.properties[key], `${path}.${key}`);
      }
      if (schema.oneOf) {
        const alternatives = schema.oneOf.filter((alternative) => Object.entries(alternative.properties ?? {})
          .every(([key, property]) => value[key] === property.const));
        assert.equal(alternatives.length, 1, `${path}: exactly one operation schema must match`);
        for (const key of alternatives[0].required) assert.ok(Object.hasOwn(value, key), `${path}: missing ${key}`);
      }
      break;
    default: assert.fail(`${path}: unsupported validation schema ${schema.type}`);
  }
  if (schema.enum) assert.ok(schema.enum.includes(value), `${path}: unsupported value`);
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
    for (const alternative of tool.required_any_of ?? []) {
      assert.ok(alternative.length > 0, `${tool.name}: empty required alternative`);
      assert.equal(new Set(alternative).size, alternative.length, `${tool.name}: duplicate alternative fields`);
      for (const key of alternative) {
        assert.ok([...tool.required, ...tool.optional].includes(key), `${tool.name}: unknown alternative field ${key}`);
      }
    }
    assert.ok(tool.scopes_any.length > 0);
    for (const key of Object.keys(tool.argument_schemas ?? {})) {
      assert.ok([...tool.required, ...tool.optional].includes(key), `${tool.name}: schema for unsupported ${key}`);
    }
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
        assert.ok(Object.hasOwn(args, key), `${path}: missing ${key}`);
        if (typeof args[key] === "string") assert.ok(args[key].trim(), `${path}: empty ${key}`);
      }
      if (schema.required_any_of?.length) {
        assert.ok(schema.required_any_of.some((keys) => keys.every((key) => typeof args[key] === "string")),
          `${path}: missing required alternative ${JSON.stringify(schema.required_any_of)}`);
      }
      for (const [key, value] of Object.entries(args)) {
        assert.ok([...schema.required, ...schema.optional].includes(key), `${path}: unsupported ${key}`);
        validateValue(value, schema.argument_schemas?.[key] ?? { type: "string" }, `${path}: ${key}`);
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
