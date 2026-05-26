import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("published docs do not contain copied secrets or Authorization header examples", () => {
  const root = new URL("..", import.meta.url).pathname;
  const docs = collectTextFiles(join(root, "examples"));
  docs.push(join(root, "README.md"));

  for (const path of docs) {
    const body = readFileSync(path, "utf8");
    assert.doesNotMatch(body, /vdoc_[A-Za-z0-9._~+/=-]{8,}/, path);
    assert.doesNotMatch(body, /Authorization\s*:/i, path);
  }
});

function collectTextFiles(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...collectTextFiles(path));
    } else if (/\.(md|json|jsonc|ts|mjs)$/.test(name)) {
      entries.push(path);
    }
  }
  return entries;
}
