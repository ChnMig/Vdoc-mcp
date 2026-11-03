import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function fixture(t, version, packed = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vdoc-npm-publish-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ["scripts", ".artifacts/release", "package", "bin"]) await mkdir(join(root, path), { recursive: true });
  await copyFile(new URL("../scripts/publish-npm.sh", import.meta.url), join(root, "scripts/publish-npm.sh"));
  const pkg = { name: "@chnmig/vdoc-mcp", version };
  await writeFile(join(root, "package.json"), JSON.stringify(pkg));
  await writeFile(join(root, "package/package.json"), JSON.stringify({ ...pkg, ...packed }));
  const archive = join(root, `.artifacts/release/vdoc-mcp-${version}.tgz`);
  execFileSync("tar", ["-czf", archive, "-C", root, "package"]);
  const checksum = createHash("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(join(root, ".artifacts/release/SHA256SUMS"), `${checksum}  vdoc-mcp-${version}.tgz\n`);
  const calls = join(root, "npm-calls");
  await writeFile(join(root, "bin/npm"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$VDOC_NPM_TEST_CALLS"\n');
  await chmod(join(root, "bin/npm"), 0o755);
  return {
    archive,
    calls,
    run: (...args) => spawnSync("bash", [join(root, "scripts/publish-npm.sh"), ...args], {
      encoding: "utf8", env: { ...process.env, PATH: `${join(root, "bin")}:${process.env.PATH}`, VDOC_NPM_TEST_CALLS: calls },
    }),
  };
}

for (const [version, channel] of [["0.4.0-beta.6", "beta"], ["0.4.0", "latest"]]) {
  test(`npm publication of ${version} uses only ${channel} and the verified archive`, { skip: process.platform === "win32" }, async t => {
    const f = await fixture(t, version);
    for (const extra of [[], ["--dry-run"]]) {
      const result = f.run(`v${version}`, ...extra);
      assert.equal(result.status, 0, result.stderr);
      const args = (await readFile(f.calls, "utf8")).trim().split("\n");
      assert.deepEqual(args, ["publish", f.archive, "--registry=https://registry.npmjs.org/", "--access", "public", "--tag", channel, ...extra]);
    }
  });
}

test("npm publication refuses unsupported channels, altered archives and mismatched package identity", { skip: process.platform === "win32" }, async t => {
  for (const packed of [{ name: "unrelated" }, { version: "9.9.9" }]) {
    const f = await fixture(t, "0.4.0-beta.6", packed);
    assert.notEqual(f.run("v0.4.0-beta.6").status, 0);
    await assert.rejects(readFile(f.calls), { code: "ENOENT" });
  }
  const f = await fixture(t, "0.4.0-beta.6");
  assert.notEqual(f.run("v0.4.0-rc.1").status, 0);
  assert.notEqual(f.run("v0.4.0-beta.6", "--tag=latest").status, 0);
  await writeFile(f.archive, Buffer.concat([await readFile(f.archive), Buffer.from("tampered")]));
  assert.notEqual(f.run("v0.4.0-beta.6").status, 0);
  await assert.rejects(readFile(f.calls), { code: "ENOENT" });
});
