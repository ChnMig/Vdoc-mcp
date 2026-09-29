import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { installSkill } from "../dist/skill-install.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const cli = join(packageRoot, "dist/index.js");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vdoc-skill-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "package/skills/vdoc");
  await mkdir(join(source, "references"), { recursive: true });
  await writeFile(join(source, "SKILL.md"), "first version");
  await writeFile(join(source, "references/workflow.md"), "first reference");
  return { root, source, target: join(root, "agent/skills/vdoc") };
}

test("an installed Skill follows replacement of the whole package, including reference files", async (t) => {
  const { source, target } = await fixture(t);
  assert.equal(await installSkill(target, source), "installed");
  assert.equal(await installSkill(target, source), "unchanged");
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "first version");
  await rm(resolve(source, "../.."), { recursive: true });
  await mkdir(join(source, "references"), { recursive: true });
  await writeFile(join(source, "SKILL.md"), "second version");
  await writeFile(join(source, "references/workflow.md"), "second reference");
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "second version");
  assert.equal(await readFile(join(target, "references/workflow.md"), "utf8"), "second reference");
});

test("existing directories, files, and foreign or broken links are never overwritten", async (t) => {
  const { root, source, target } = await fixture(t);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "SKILL.md"), "my custom workflow");
  await assert.rejects(installSkill(target, source), /already exists/);
  assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "my custom workflow");
  const file = join(root, "personal-rule");
  await writeFile(file, "personal");
  await assert.rejects(installSkill(file, source), /already exists/);
  assert.equal(await readFile(file, "utf8"), "personal");
  const link = join(root, "foreign-link");
  await symlink(join(root, "missing"), link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(installSkill(link, source), /already exists/);
  assert.equal(await readlink(link), join(root, "missing"));
});

test("Skill CLI installs without connecting to the backend or requiring a token", async (t) => {
  const { root, target } = await fixture(t);
  const env = { ...process.env, VDOC_BASE_URL: "", VDOC_MCP_URL: "", VDOC_MCP_TOKEN: "" };
  const output = execFileSync(process.execPath, [cli, "skill", "install", "--directory", target], { cwd: root, env, encoding: "utf8" });
  assert.match(output, /Skill linked/);
  assert.match(await readFile(join(target, "SKILL.md"), "utf8"), /name: vdoc/);
  assert.throws(() => execFileSync(process.execPath, [cli, "skill", "install", "--unknown"], { env, stdio: "pipe" }), /Usage:/);
});

test("the actual npm archive contains one complete Skill and the executable installer", async (t) => {
  const { root } = await fixture(t);
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", root], {
    cwd: packageRoot,
    env: { ...process.env, npm_config_cache: join(root, "npm-cache") },
    encoding: "utf8",
  }));
  const paths = packed[0].files.map((file) => file.path);
  for (const path of ["dist/index.js", "dist/skill-install.js", "skills/vdoc/SKILL.md", "skills/vdoc/references/mcp-tools.json", "skills/vdoc/templates/endpoint-integration.md"]) {
    assert.ok(paths.includes(path), `missing packaged file: ${path}`);
  }
  assert.deepEqual(paths.filter((path) => path.endsWith("SKILL.md")), ["skills/vdoc/SKILL.md"]);
  assert.ok(!paths.some((path) => path.startsWith("skills/vdoc/.github/") || path === "skills/vdoc/package.json"));
});
