import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = join(packageRoot, "dist/index.js");
const disconnectedEnv = { ...process.env, VDOC_BASE_URL: "", VDOC_MCP_URL: "", VDOC_MCP_TOKEN: "" };

test("CLI help and version work without a backend connection", async () => {
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(execFileSync(process.execPath, [cli, "--version"], { env: disconnectedEnv, encoding: "utf8" }).trim(), pkg.version);
  const help = execFileSync(process.execPath, [cli, "--help"], { env: disconnectedEnv, encoding: "utf8" });
  assert.match(help, /MCP stdio server/);
  assert.doesNotMatch(help, /skill/i);
});

test("retired Skill commands are rejected before loading connection credentials", () => {
  for (const args of [["skill", "install"], ["skill", "path"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { env: disconnectedEnv, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Unknown arguments/);
  }
});

test("the release archive contains the adapter and updater without Skill assets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "vdoc-mcp-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", directory], {
    cwd: packageRoot,
    env: { ...process.env, npm_config_cache: join(directory, "npm-cache") },
    encoding: "utf8",
  }));
  const paths = packed[0].files.map(file => file.path);
  for (const path of ["dist/index.js", "dist/mcp-server.js", "scripts/install-channel.mjs"]) {
    assert.ok(paths.includes(path), `missing packaged file: ${path}`);
  }
  assert.ok(!paths.some(path => path.startsWith("skills/") || /skill-install|SKILL\.md/.test(path)));
});
