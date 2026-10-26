#!/usr/bin/env node
// Standalone installer: only Node.js built-ins are required before installation.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, parse, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repository = "ChnMig/Vdoc-mcp";
const apiRoot = `https://api.github.com/repos/${repository}/releases`;
const downloadRoot = `https://github.com/${repository}/releases/download`;
const markerName = ".vdoc-mcp-channel.json";
const lockName = ".vdoc-mcp-install-lock";
const channels = new Set(["beta", "release"]);
const execFileAsync = promisify(execFile);
const usage = "Usage: node install-channel.mjs [--channel release|beta] [--prefix ABSOLUTE_PATH]";
const shellQuote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";

export function parseArgs(args) {
  if (args.length === 1 && args[0] === "--help") return { help: true };
  const options = { channel: "release" };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!["--channel", "--prefix"].includes(flag) || seen.has(flag) || !value?.trim() || value.startsWith("--")) {
      throw new Error(usage);
    }
    seen.add(flag);
    options[flag.slice(2)] = value;
  }
  if (!channels.has(options.channel)) throw new Error(usage);
  if (options.prefix !== undefined && !isAbsolute(options.prefix)) {
    throw new Error("--prefix must be an absolute path. " + usage);
  }
  return options;
}

function versionFor(tag, channel) {
  if (typeof tag !== "string") return undefined;
  const core = "(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)";
  const pattern = new RegExp(`^v${core}${channel === "beta" ? "-beta\\.(0|[1-9][0-9]*)" : ""}$`);
  const match = pattern.exec(tag);
  return match?.slice(1).map(BigInt);
}

export function chooseRelease(releases, channel) {
  if (!channels.has(channel)) throw new Error("Channel must be release or beta.");
  let selected;
  let selectedVersion;
  for (const release of releases) {
    if (!release || release.draft !== false || release.prerelease !== (channel === "beta")) continue;
    const version = versionFor(release.tag_name, channel);
    if (!version) continue;
    const higher = !selectedVersion || version.some((part, i) =>
      part > selectedVersion[i] && version.slice(0, i).every((previous, j) => previous === selectedVersion[j]));
    if (higher) {
      selected = release;
      selectedVersion = version;
    }
  }
  if (!selected) throw new Error(`No published ${channel} release is available. No other channel or branch will be installed.`);
  return selected;
}

async function request(url, fetchImpl, assets = false) {
  let current = url;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: assets ? { "User-Agent": "vdoc-channel-installer" } : {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "vdoc-channel-installer",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!assets || !location) throw new Error("Unexpected GitHub API redirect.");
      const target = new URL(location, current);
      if (target.protocol !== "https:" || target.username || target.password || target.port ||
          !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname)) {
        throw new Error("Untrusted GitHub release asset redirect.");
      }
      current = target.href;
      continue;
    }
    if (!response.ok) throw new Error(`GitHub ${assets ? "asset download" : "API request"} failed (HTTP ${response.status}). No package was installed.`);
    return response;
  }
  throw new Error("Too many GitHub release asset redirects.");
}

async function latestRelease(channel, fetchImpl) {
  const releases = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await request(`${apiRoot}?per_page=100&page=${page}`, fetchImpl);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("Invalid GitHub releases API response.");
    releases.push(...batch);
    if (batch.length < 100) return chooseRelease(releases, channel);
  }
  throw new Error("GitHub release pagination exceeded the supported limit; no package was installed.");
}

function assetURL(release, name) {
  const assets = release.assets?.filter(asset => asset?.name === name);
  if (assets?.length !== 1) throw new Error(`Release ${release.tag_name} must contain exactly one ${name} asset.`);
  const expected = `${downloadRoot}/${release.tag_name}/${name}`;
  if (assets[0].browser_download_url !== expected) throw new Error(`Untrusted GitHub release asset URL for ${name}.`);
  return expected;
}

async function readAsset(url, fetchImpl, maxBytes) {
  const response = await request(url, fetchImpl, true);
  const size = response.headers.get("content-length");
  if (size && Number(size) > maxBytes) throw new Error("GitHub release asset exceeds the size limit.");
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (received > maxBytes) throw new Error("GitHub release asset exceeds the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function verifyChecksum(body, archive, filename) {
  const matches = body.toString("utf8").split(/\r?\n/).flatMap(line => {
    const match = /^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/.exec(line);
    return match && match[2] === filename ? [match[1].toLowerCase()] : [];
  });
  if (matches.length !== 1) throw new Error(`SHA256SUMS must contain exactly one checksum for ${filename}.`);
  if (createHash("sha256").update(archive).digest("hex") !== matches[0]) {
    throw new Error("Release archive SHA-256 checksum mismatch. No package was installed.");
  }
}

function within(path, parent) {
  const child = relative(parent, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function validatePrefix(prefix, channel, homeDirectory) {
  if (!isAbsolute(prefix)) throw new Error("Installation prefix must be an absolute path.");
  const absolute = resolve(prefix);
  const home = resolve(homeDirectory);
  const otherChannel = channel === "release" ? "beta" : "release";
  const otherPrefix = join(home, ".local", "share", "vdoc", "mcp", otherChannel);
  if (absolute === parse(absolute).root || within(home, absolute) || within(otherPrefix, absolute) || within(absolute, otherPrefix)) {
    throw new Error("Installation prefix must be a dedicated channel directory, separate from home, root and the other channel.");
  }
  return absolute;
}

async function inspectPrefix(prefix, channel, installing = false) {
  const existing = await lstat(prefix).catch(error => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!existing) return;
  if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error("Installation prefix must be a real dedicated directory, not a symlink.");
  let marker;
  try {
    marker = JSON.parse(await readFile(join(prefix, markerName), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Invalid Vdoc channel marker in installation prefix.");
  }
  if (marker) {
    if (marker.repository !== repository || marker.channel !== channel) {
      throw new Error("Installation prefix belongs to another channel or package; select a separate prefix.");
    }
  } else {
    const entries = (await readdir(prefix)).filter(name => !(installing && name === lockName));
    if (entries.length) throw new Error("Installation prefix is not empty and is not owned by this Vdoc channel installer.");
  }
}

export async function defaultNpmInstall(archive, prefix, {
  platform = process.platform,
  nodePath = process.execPath,
  searchPath = Object.entries(process.env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "",
  fileStat = stat,
  run = execFileAsync,
} = {}) {
  const args = [
    "install", "--prefix", prefix, "--no-save", "--ignore-scripts", "--global=false",
    "--package-lock=false", "--no-audit", "--no-fund", archive,
  ];
  let command = "npm";
  if (platform === "win32") {
    // Windows cannot execFile an npm.cmd shim. Run npm's JavaScript entry with
    // this Node executable so paths stay separate arguments without a shell.
    const directories = [win32.dirname(nodePath), ...searchPath.split(";")]
      .map(directory => directory.trim().replace(/^"(.*)"$/, "$1"))
      .filter(directory => win32.isAbsolute(directory));
    const candidates = [...new Set(directories.flatMap(directory => [
      win32.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
      win32.join(directory, "npm-cli.js"),
    ]))];
    let npmCli;
    for (const candidate of candidates) {
      const file = await fileStat(candidate).catch(error => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
        throw error;
      });
      if (file?.isFile()) {
        npmCli = candidate;
        break;
      }
    }
    if (!npmCli) throw new Error("Cannot find npm-cli.js next to Node.js or on PATH. Install npm with this Node.js distribution and retry.");
    command = nodePath;
    args.unshift(npmCli);
  }
  await run(command, args, { maxBuffer: 4 * 1024 * 1024, shell: false });
}

export async function installChannel({ channel = "release", prefix, homeDirectory = homedir(), fetchImpl = globalThis.fetch, npmInstall = defaultNpmInstall, log = console.log } = {}) {
  if (!channels.has(channel)) throw new Error("Channel must be release or beta.");
  const target = validatePrefix(prefix ?? join(homeDirectory, ".local", "share", "vdoc", "mcp", channel), channel, homeDirectory);
  await inspectPrefix(target, channel);
  const release = await latestRelease(channel, fetchImpl);
  const version = release.tag_name.slice(1);
  const filename = `vdoc-mcp-${version}.tgz`;
  const archiveURL = assetURL(release, filename);
  const checksumURL = assetURL(release, "SHA256SUMS");
  // Older archives predate the persistent updater. Reject them before npm can
  // mutate a prefix; a working update command is part of a channel install.
  assetURL(release, "install-channel.mjs");
  assetURL(release, "install-channel.mjs.sha256");
  const checksums = await readAsset(checksumURL, fetchImpl, 1024 * 1024);
  const archive = await readAsset(archiveURL, fetchImpl, 100 * 1024 * 1024);
  verifyChecksum(checksums, archive, filename);

  const temporary = await mkdtemp(join(tmpdir(), "vdoc-mcp-channel-"));
  let locked = false;
  try {
    const localArchive = join(temporary, filename);
    await writeFile(localArchive, archive);
    await mkdir(target, { recursive: true });
    try {
      await mkdir(join(target, lockName));
      locked = true;
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("Another installation owns this prefix lock. Wait for it to finish; after a crash, inspect and remove .vdoc-mcp-install-lock before retrying.");
      throw error;
    }
    await inspectPrefix(target, channel, true);
    await writeFile(join(target, markerName), JSON.stringify({ repository, channel }, null, 2) + "\n");
    await npmInstall(localArchive, target);
    const packageRoot = join(target, "node_modules", "@vdoc", "mcp");
    const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    if (pkg.name !== "@vdoc/mcp" || pkg.version !== version) throw new Error("Installed package does not match the selected release.");
    for (const path of [join(packageRoot, "dist", "index.js"), join(packageRoot, "skills", "vdoc", "SKILL.md"), join(packageRoot, "scripts", "install-channel.mjs")]) {
      const file = await stat(path).catch(error => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!file?.isFile()) throw new Error("Release package is missing the prebuilt adapter, bundled Skill or channel updater. Select a release containing channel installation support.");
    }
    const command = join(target, "node_modules", ".bin", "vdoc-mcp");
    await stat(command);
    await writeFile(join(target, markerName), JSON.stringify({ repository, channel, tag: release.tag_name }, null, 2) + "\n");
    log(`Installed Vdoc MCP + Skill ${release.tag_name} (${channel}).`);
    log(`MCP command: ${command}`);
    log("Use this absolute command in your agent config with the matching backend URL and token.");
    log("Link its Skill to a separate agent/project skill directory with: <MCP command> skill install --directory <PATH>/vdoc");
    log(`Update: node ${shellQuote(join(packageRoot, "scripts", "install-channel.mjs"))} --channel ${channel} --prefix ${shellQuote(target)}`);
    log("Restart MCP and reload your agent after updating.");
    return { channel, tag: release.tag_name, prefix: target, command };
  } finally {
    if (locked) await rm(join(target, lockName), { recursive: true, force: true });
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js 20 or newer is required.");
    const options = parseArgs(process.argv.slice(2));
    if (options.help) console.log(usage);
    else await installChannel(options);
  } catch (error) {
    console.error(`Vdoc channel installation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
