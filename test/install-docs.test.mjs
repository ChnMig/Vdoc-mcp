import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const pinnedInstall = readme.match(/```sh\s*([\s\S]*?VDOC_MCP_COMMIT[\s\S]*?)```/)[1];

test("documented Git installation stops when the workspace lock cannot provide an exact commit", () => {
  const stubs = `
    jq() { printf '%s\\n' "$FIXTURE_COMMIT"; return "$FIXTURE_JQ_STATUS"; }
    npx() { printf 'NPX_CALLED: %s\\n' "$*"; }
  `;
  for (const [commit, jqStatus] of [["", "2"], ["", "0"], ["main", "0"]]) {
    const result = spawnSync("sh", ["-c", `${stubs}\n${pinnedInstall}`], {
      encoding: "utf8",
      env: { ...process.env, FIXTURE_COMMIT: commit, FIXTURE_JQ_STATUS: jqStatus },
    });
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /NPX_CALLED:/);
  }
  const commit = "a".repeat(40);
  const result = spawnSync("sh", ["-c", `${stubs}\n${pinnedInstall}`], {
    encoding: "utf8",
    env: { ...process.env, FIXTURE_COMMIT: commit, FIXTURE_JQ_STATUS: "0" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`NPX_CALLED: --yes github:ChnMig/Vdoc-mcp#${commit}`));
});
