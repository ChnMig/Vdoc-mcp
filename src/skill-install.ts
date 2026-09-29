import { lstat, mkdir, readlink, stat, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const bundledSkillDirectory = fileURLToPath(new URL("../skills/vdoc/", import.meta.url));

// A directory link keeps every reference/example on the package's version without
// an install hook writing into unrelated agent directories during npm updates.
export async function installSkill(directory: string, source = bundledSkillDirectory): Promise<"installed" | "unchanged"> {
  const target = resolve(directory);
  const bundled = resolve(source);
  if (!(await stat(join(bundled, "SKILL.md"))).isFile()) {
    throw new Error("The package does not contain skills/vdoc/SKILL.md. Reinstall the complete Vdoc MCP package.");
  }
  const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing) {
    if (existing.isSymbolicLink() && resolve(dirname(target), await readlink(target)) === bundled) {
      return "unchanged";
    }
    throw new Error(`Skill destination already exists: ${target}. Preserve your local changes and move the old installation before retrying; no files were replaced.`);
  }
  await mkdir(dirname(target), { recursive: true });
  await symlink(bundled, target, process.platform === "win32" ? "junction" : "dir");
  return "installed";
}

export async function runSkillCommand(args: string[]): Promise<void> {
  if (args.length === 1 && args[0] === "path") {
    console.log(bundledSkillDirectory);
    return;
  }
  if (args[0] !== "install" || !(
    args.length === 1 || (args.length === 3 && args[1] === "--directory" && args[2].trim())
  )) {
    throw new Error("Usage: vdoc-mcp skill install [--directory PATH] | vdoc-mcp skill path");
  }
  const directory = resolve(args[2] ?? join(homedir(), ".agents", "skills", "vdoc"));
  const result = await installSkill(directory);
  console.log(`Vdoc Skill ${result === "installed" ? "linked" : "already linked"}: ${directory}`);
  console.log("Keep this package installed at the same path for linked Skill updates. Reload your agent after updating it.");
}
