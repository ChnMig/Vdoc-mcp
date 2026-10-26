import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chooseRelease, defaultNpmInstall, installChannel, parseArgs } from "../scripts/install-channel.mjs";

const repository = "ChnMig/Vdoc-mcp";
const releasesURL = `https://api.github.com/repos/${repository}/releases?per_page=100&page=1`;
const markerName = ".vdoc-mcp-channel.json";

function release(tag, overrides = {}) {
  const version = tag.replace(/^v/, "");
  const archiveName = `vdoc-mcp-${version}.tgz`;
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes("-"),
    assets: [
      { name: archiveName, browser_download_url: `${base}/${archiveName}` },
      { name: "SHA256SUMS", browser_download_url: `${base}/SHA256SUMS` },
      { name: "install-channel.mjs", browser_download_url: `${base}/install-channel.mjs` },
      { name: "install-channel.mjs.sha256", browser_download_url: `${base}/install-channel.mjs.sha256` },
    ],
    ...overrides,
  };
}

function releaseBytes(item) {
  return Buffer.from(JSON.stringify({ version: item.tag_name.slice(1) }));
}

function mockFetch(items, { checksum, apiStatus = 200, assetStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === releasesURL) {
      return new Response(JSON.stringify(items), { status: apiStatus });
    }
    if (url.startsWith(`https://api.github.com/repos/${repository}/releases?per_page=100&page=`)) {
      return new Response("[]");
    }
    for (const item of items) {
      const bytes = releaseBytes(item);
      const archive = item.assets.find((asset) => asset.name.endsWith(".tgz"));
      const checksums = item.assets.find((asset) => asset.name === "SHA256SUMS");
      if (archive && url === archive.browser_download_url) {
        return new Response(bytes, { status: assetStatus });
      }
      if (checksums && url === checksums.browser_download_url) {
        const digest = createHash("sha256").update(bytes).digest("hex");
        return new Response(checksum ?? `${digest}  ${archive.name}\n`);
      }
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  return { calls, fetchImpl };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "vdoc-channel-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const homeDirectory = join(root, "home");
  await mkdir(homeDirectory);
  return {
    root,
    homeDirectory,
    releasePrefix: join(root, "mcp/release"),
    betaPrefix: join(root, "mcp/beta"),
  };
}

function mockNpmInstall({ mutatePackage } = {}) {
  const calls = [];
  const npmInstall = async (archivePath, prefix) => {
    const bytes = await readFile(archivePath);
    const archivePackage = JSON.parse(bytes.toString());
    calls.push({ archivePath, prefix, bytes, version: archivePackage.version });
    const packageDirectory = join(prefix, "node_modules/@vdoc/mcp");
    await mkdir(join(packageDirectory, "dist"), { recursive: true });
    await mkdir(join(packageDirectory, "scripts"), { recursive: true });
    await mkdir(join(packageDirectory, "skills/vdoc"), { recursive: true });
    await mkdir(join(prefix, "node_modules/.bin"), { recursive: true });
    await writeFile(join(packageDirectory, "package.json"), JSON.stringify({ name: "@vdoc/mcp", version: archivePackage.version }));
    await writeFile(join(packageDirectory, "dist/index.js"), "// test CLI\n");
    await writeFile(join(packageDirectory, "scripts/install-channel.mjs"), "// test installer\n");
    await writeFile(join(packageDirectory, "skills/vdoc/SKILL.md"), `test skill ${archivePackage.version}\n`);
    await writeFile(join(prefix, "node_modules/.bin/vdoc-mcp"), "// test command\n");
    await mutatePackage?.(packageDirectory);
  };
  return { calls, npmInstall };
}

async function marker(prefix) {
  return JSON.parse(await readFile(join(prefix, markerName), "utf8"));
}

test("release selection excludes beta, drafts, and prerelease-flagged stable versions", () => {
  const stable = release("v1.2.3");
  assert.equal(chooseRelease([
    release("v9.0.0-beta.1"),
    release("v8.0.0-beta.1", { prerelease: false }),
    release("v7.0.0", { draft: true }),
    release("v6.0.0", { prerelease: true }),
    stable,
  ], "release"), stable);
});

test("beta selection stays on beta and sorts beta.10 after beta.9 numerically", () => {
  const beta = release("v1.2.3-beta.10");
  assert.equal(chooseRelease([
    release("v9.0.0"),
    release("v8.0.0-rc.1"),
    release("v7.0.0-beta.1", { draft: true }),
    release("v6.0.0-beta.1", { prerelease: false }),
    release("v1.2.3-beta.9"),
    beta,
  ], "beta"), beta);
});

test("release and beta selection sort numeric core versions, independent of API order", () => {
  const stable = release("v1.10.0");
  const beta = release("v2.0.0-beta.0");
  assert.equal(chooseRelease([release("v1.9.9"), stable, release("v1.2.99")], "release"), stable);
  assert.equal(chooseRelease([release("v1.99.99-beta.99"), beta, release("v1.2.3-beta.100")], "beta"), beta);
});

test("noncanonical tags cannot become a channel update", () => {
  const invalid = [
    "1.2.3", "v01.2.3", "v1.02.3", "v1.2.03", "v1.2.3-beta.01",
    "v1.2.3-beta", "v1.2.3-beta.1.extra", "v1.2.3+build", "v1.2.3-rc.1",
  ].map((tag) => release(tag));
  assert.throws(() => chooseRelease(invalid, "release"));
  assert.throws(() => chooseRelease(invalid, "beta"));
  assert.throws(() => chooseRelease([], "release"));
  assert.throws(() => chooseRelease([release("v1.2.3")], "beta"));
  assert.throws(() => chooseRelease([release("v1.2.3-beta.1")], "release"));
});

test("argument parsing defaults to release and accepts explicit absolute channel prefixes", () => {
  assert.equal(parseArgs([]).channel, "release");
  assert.equal(parseArgs([]).prefix, undefined);
  assert.deepEqual(parseArgs(["--channel", "beta", "--prefix", "/tmp/vdoc-test-beta"]), { channel: "beta", prefix: "/tmp/vdoc-test-beta" });
  assert.deepEqual(parseArgs(["--prefix", "/tmp/vdoc-test-release", "--channel", "release"]), { channel: "release", prefix: "/tmp/vdoc-test-release" });
  assert.deepEqual(parseArgs(["--help"]), { help: true });
});

test("argument parsing rejects invalid, incomplete, relative, duplicate, and unknown options", () => {
  for (const args of [
    ["--channel", "stable"], ["--channel", ""], ["--channel"],
    ["--prefix", ""], ["--prefix"], ["--prefix", "relative/path"],
    ["--unknown"], ["beta"], ["--help", "--channel", "beta"], ["--channel", "beta", "--channel", "beta"],
    ["--prefix", "/tmp/a", "--prefix", "/tmp/b"],
  ]) {
    assert.throws(() => parseArgs(args), `should reject ${JSON.stringify(args)}`);
  }
});

test("installation verifies the downloaded archive and returns the channel-specific command", async (t) => {
  const { homeDirectory, betaPrefix: prefix } = await fixture(t);
  const selected = release("v1.2.3-beta.10");
  const fetch = mockFetch([release("v9.0.0"), selected]);
  const npm = mockNpmInstall();
  const result = await installChannel({ channel: "beta", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  assert.deepEqual(result, { channel: "beta", tag: selected.tag_name, prefix, command: join(prefix, "node_modules/.bin/vdoc-mcp") });
  assert.equal(npm.calls.length, 1);
  assert.equal(npm.calls[0].prefix, prefix);
  assert.deepEqual(npm.calls[0].bytes, releaseBytes(selected));
  assert.equal(fetch.calls[0], releasesURL);
  assert.ok(fetch.calls.includes(selected.assets[0].browser_download_url));
  assert.ok(fetch.calls.includes(selected.assets[1].browser_download_url));
  const installedMarker = await marker(prefix);
  assert.equal(installedMarker.repository, repository);
  assert.equal(installedMarker.channel, "beta");
  assert.match(await readFile(join(prefix, "node_modules/@vdoc/mcp/skills/vdoc/SKILL.md"), "utf8"), /1\.2\.3-beta\.10/);
});

test("the default installation directory is isolated under the supplied home", async (t) => {
  const { homeDirectory } = await fixture(t);
  const fetch = mockFetch([release("v1.2.3")]);
  const npm = mockNpmInstall();
  const result = await installChannel({ homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  assert.equal(result.channel, "release");
  assert.equal(result.prefix, join(homeDirectory, ".local/share/vdoc/mcp/release"));
  assert.equal(npm.calls[0].prefix, result.prefix);
});

test("release discovery searches beyond a first page containing only beta releases", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const firstPage = Array.from({ length: 100 }, (_, index) => release(`v9.0.0-beta.${index}`));
  const stable = release("v1.2.3");
  const assets = mockFetch([stable]);
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = String(input);
    calls.push(url);
    if (url === releasesURL) return new Response(JSON.stringify(firstPage));
    if (url === releasesURL.replace("&page=1", "&page=2")) return new Response(JSON.stringify([stable]));
    return assets.fetchImpl(input, options);
  };
  const npm = mockNpmInstall();
  const result = await installChannel({ channel: "release", prefix, homeDirectory, fetchImpl, npmInstall: npm.npmInstall, log() {} });
  assert.equal(result.tag, "v1.2.3");
  assert.ok(calls.includes(releasesURL.replace("&page=1", "&page=2")));
  assert.equal(npm.calls.length, 1);
});

test("beta and release installations keep packages, Skills, and unrelated global files separate", async (t) => {
  const { root, homeDirectory, betaPrefix, releasePrefix } = await fixture(t);
  const unrelated = join(root, "global/node_modules/@vdoc/mcp/package.json");
  await mkdir(join(root, "global/node_modules/@vdoc/mcp"), { recursive: true });
  await writeFile(unrelated, "untouched global package\n");
  const npm = mockNpmInstall();
  const fetch = mockFetch([release("v1.2.3"), release("v1.2.4-beta.1")]);
  await installChannel({ channel: "release", prefix: releasePrefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  const releasePackage = await readFile(join(releasePrefix, "node_modules/@vdoc/mcp/package.json"), "utf8");
  const releaseSkill = await readFile(join(releasePrefix, "node_modules/@vdoc/mcp/skills/vdoc/SKILL.md"), "utf8");
  await installChannel({ channel: "beta", prefix: betaPrefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  assert.equal(await readFile(join(releasePrefix, "node_modules/@vdoc/mcp/package.json"), "utf8"), releasePackage);
  assert.equal(await readFile(join(releasePrefix, "node_modules/@vdoc/mcp/skills/vdoc/SKILL.md"), "utf8"), releaseSkill);
  assert.equal(await readFile(unrelated, "utf8"), "untouched global package\n");
  assert.equal((await marker(releasePrefix)).channel, "release");
  assert.equal((await marker(betaPrefix)).channel, "beta");
  assert.deepEqual(npm.calls.map((call) => call.prefix), [releasePrefix, betaPrefix]);
});

test("rerunning a channel updates only that prefix to its newest matching release", async (t) => {
  const { homeDirectory, betaPrefix: prefix } = await fixture(t);
  const npm = mockNpmInstall();
  const first = mockFetch([release("v1.2.3-beta.9")]);
  await installChannel({ channel: "beta", prefix, homeDirectory, fetchImpl: first.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  const second = mockFetch([release("v9.0.0"), release("v1.2.3-beta.10")]);
  const result = await installChannel({ channel: "beta", prefix, homeDirectory, fetchImpl: second.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  assert.equal(result.tag, "v1.2.3-beta.10");
  assert.deepEqual(npm.calls.map((call) => call.version), ["1.2.3-beta.9", "1.2.3-beta.10"]);
  assert.equal(JSON.parse(await readFile(join(prefix, "node_modules/@vdoc/mcp/package.json"), "utf8")).version, "1.2.3-beta.10");
  assert.equal((await marker(prefix)).channel, "beta");
});

test("an existing prefix cannot switch from release to beta", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const npm = mockNpmInstall();
  const fetch = mockFetch([release("v1.2.3"), release("v1.2.4-beta.1")]);
  await installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  const before = await readFile(join(prefix, "node_modules/@vdoc/mcp/package.json"), "utf8");
  await assert.rejects(installChannel({ channel: "beta", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
  assert.equal(npm.calls.length, 1);
  assert.equal(await readFile(join(prefix, "node_modules/@vdoc/mcp/package.json"), "utf8"), before);
  assert.equal((await marker(prefix)).channel, "release");
});

test("simultaneous same-channel installations cannot both mutate the same prefix", async (t) => {
  const { homeDirectory, betaPrefix: prefix } = await fixture(t);
  const fetch = mockFetch([release("v1.2.3-beta.1")]);
  const npm = mockNpmInstall();
  let enterInstall;
  let finishInstall;
  const entered = new Promise((resolve) => { enterInstall = resolve; });
  const finish = new Promise((resolve) => { finishInstall = resolve; });
  const options = { channel: "beta", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} };
  const first = installChannel({ ...options, npmInstall: async (...args) => {
    await npm.npmInstall(...args);
    enterInstall();
    await finish;
  } });
  await entered;
  try {
    await assert.rejects(installChannel(options), /lock|another installation/i);
    assert.equal(npm.calls.length, 1);
  } finally {
    finishInstall();
    await first;
  }
  assert.ok(!(await readdir(prefix)).includes(".vdoc-mcp-install-lock"));
});

test("unsafe prefixes are rejected before invoking npm or touching existing files", async (t) => {
  const { root, homeDirectory } = await fixture(t);
  const occupied = join(root, "occupied");
  await mkdir(occupied);
  await writeFile(join(occupied, "personal.txt"), "keep this\n");
  const fetch = mockFetch([release("v1.2.3-beta.1")]);
  const npm = mockNpmInstall();
  for (const prefix of ["/", homeDirectory, "relative/path", occupied, join(homeDirectory, ".local/share/vdoc/mcp/release")]) {
    await assert.rejects(installChannel({ channel: "beta", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }), `should reject prefix ${prefix}`);
  }
  assert.equal(npm.calls.length, 0);
  assert.deepEqual(await readdir(occupied), ["personal.txt"]);
  assert.equal(await readFile(join(occupied, "personal.txt"), "utf8"), "keep this\n");
});

test("a GitHub API error or missing channel release never invokes npm", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  for (const fetch of [mockFetch([], { apiStatus: 503 }), mockFetch([release("v1.2.3-beta.1")])]) {
    const npm = mockNpmInstall();
    await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
    assert.equal(npm.calls.length, 0);
  }
});

test("a missing, malformed, or mismatched checksum prevents npm installation", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const selected = release("v1.2.3");
  const digest = createHash("sha256").update(releaseBytes(selected)).digest("hex");
  const checksumLine = `${digest}  ${selected.assets[0].name}\n`;
  for (const checksum of ["", `not-a-sha256  ${selected.assets[0].name}\n`, `${"0".repeat(64)}  ${selected.assets[0].name}\n`, `${"0".repeat(64)}  other-package.tgz\n`, checksumLine + checksumLine]) {
    const fetch = mockFetch([selected], { checksum });
    const npm = mockNpmInstall();
    await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
    assert.equal(npm.calls.length, 0);
  }
});

test("assets from another host, repository, tag, or filename are refused", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const unsafeURLs = [
    "https://example.com/vdoc-mcp-1.2.3.tgz",
    "https://github.com/other/repository/releases/download/v1.2.3/vdoc-mcp-1.2.3.tgz",
    `https://github.com/${repository}/releases/download/v9.0.0/vdoc-mcp-1.2.3.tgz`,
    `https://github.com/${repository}/releases/download/v1.2.3/other-package.tgz`,
    `http://github.com/${repository}/releases/download/v1.2.3/vdoc-mcp-1.2.3.tgz`,
  ];
  for (const unsafeURL of unsafeURLs) {
    const selected = release("v1.2.3");
    selected.assets[0].browser_download_url = unsafeURL;
    const fetch = mockFetch([selected]);
    const npm = mockNpmInstall();
    await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
    assert.equal(npm.calls.length, 0);
    assert.ok(!fetch.calls.includes(unsafeURL), "unsafe asset must not be fetched");
  }
});

test("a checksum asset from another host is refused without fetching it", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const selected = release("v1.2.3");
  const unsafeURL = "https://example.com/SHA256SUMS";
  selected.assets[1].browser_download_url = unsafeURL;
  const fetch = mockFetch([selected]);
  const npm = mockNpmInstall();
  await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
  assert.equal(npm.calls.length, 0);
  assert.ok(!fetch.calls.includes(unsafeURL));
});

test("asset redirects refuse untrusted or insecure targets and accept the GitHub release CDN", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const selected = release("v1.2.3");
  const archiveURL = selected.assets[0].browser_download_url;
  const npm = mockNpmInstall();
  for (const target of [
    "https://evil.example/download/vdoc-mcp-1.2.3.tgz",
    `http://github.com/${repository}/releases/download/v1.2.3/vdoc-mcp-1.2.3.tgz`,
  ]) {
    const assets = mockFetch([selected]);
    const calls = [];
    const fetchImpl = async (input, options) => {
      const url = String(input);
      calls.push(url);
      assert.equal(options.redirect, "manual");
      if (url === archiveURL) return new Response(null, { status: 302, headers: { location: target } });
      return assets.fetchImpl(input, options);
    };
    await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl, npmInstall: npm.npmInstall, log() {} }), /redirect|untrusted/i);
    assert.ok(calls.includes(archiveURL));
    assert.ok(!calls.includes(target), "a refused redirect target must never be fetched");
    assert.equal(npm.calls.length, 0);
  }

  const assets = mockFetch([selected]);
  const target = "https://release-assets.githubusercontent.com/github-production-release-asset/test/vdoc-mcp-1.2.3.tgz";
  const calls = [];
  const fetchImpl = async (input, options) => {
    const url = String(input);
    calls.push(url);
    assert.equal(options.redirect, "manual");
    if (url === archiveURL) return new Response(null, { status: 302, headers: { location: target } });
    if (url === target) return new Response(releaseBytes(selected));
    return assets.fetchImpl(input, options);
  };
  const result = await installChannel({ channel: "release", prefix, homeDirectory, fetchImpl, npmInstall: npm.npmInstall, log() {} });
  assert.equal(result.tag, selected.tag_name);
  assert.ok(calls.includes(target));
  assert.equal(npm.calls.length, 1);
  assert.deepEqual(npm.calls[0].bytes, releaseBytes(selected));
});

test("the Windows npm launcher uses Node and preserves every installation argument without a shell", async () => {
  const nodePath = "C:\\Program Files\\nodejs\\node.exe";
  const npmCli = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
  const archive = "D:\\Downloads & docs\\vdoc^(test)%PATH%!.tgz";
  const prefix = "D:\\Vdoc & Test\\beta %USERPROFILE%!";
  const inspected = [];
  const calls = [];
  await defaultNpmInstall(archive, prefix, {
    platform: "win32", nodePath, searchPath: "D:\\Other npm",
    fileStat: async path => {
      inspected.push(path);
      return { isFile: () => path === npmCli };
    },
    run: async (...args) => calls.push(args),
  });
  assert.deepEqual(inspected, [npmCli], "the current Node distribution takes precedence over PATH");
  assert.deepEqual(calls, [[nodePath, [
    npmCli, "install", "--prefix", prefix, "--no-save", "--ignore-scripts", "--global=false",
    "--package-lock=false", "--no-audit", "--no-fund", archive,
  ], { maxBuffer: 4 * 1024 * 1024, shell: false }]]);
});

test("the Windows npm launcher finds an npm CLI on PATH after missing or non-file candidates", async () => {
  for (const npmCli of [
    "D:\\Npm tools\\node_modules\\npm\\bin\\npm-cli.js",
    "D:\\Npm tools\\npm-cli.js",
  ]) {
    const inspected = [];
    const calls = [];
    await defaultNpmInstall("archive.tgz", "prefix", {
      platform: "win32", nodePath: "C:\\Node\\node.exe", searchPath: 'relative;"D:\\Npm tools"',
      fileStat: async path => {
        inspected.push(path);
        if (path === "C:\\Node\\node_modules\\npm\\bin\\npm-cli.js") return { isFile: () => false };
        if (path === npmCli) return { isFile: () => true };
        throw Object.assign(new Error("missing fixture"), { code: "ENOENT" });
      },
      run: async (...args) => calls.push(args),
    });
    assert.equal(calls[0][0], "C:\\Node\\node.exe");
    assert.equal(calls[0][1][0], npmCli);
    assert.ok(!inspected.some(path => path.startsWith("relative")), "relative PATH entries are not executable candidates");
  }
});

test("the Windows npm launcher fails clearly without starting a command when npm is missing", async () => {
  let calls = 0;
  await assert.rejects(defaultNpmInstall("archive.tgz", "prefix", {
    platform: "win32", nodePath: "C:\\Node\\node.exe", searchPath: "",
    fileStat: async () => { throw Object.assign(new Error("missing fixture"), { code: "ENOENT" }); },
    run: async () => { calls += 1; },
  }), /Cannot find npm-cli\.js.*Install npm/);
  assert.equal(calls, 0);
});

test("the Unix npm launcher continues to use npm from PATH without inspecting Windows locations", async () => {
  const calls = [];
  await defaultNpmInstall("archive.tgz", "/tmp/local prefix", {
    platform: "darwin",
    fileStat: async () => { assert.fail("Unix installations must use the existing npm launcher"); },
    run: async (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [["npm", [
    "install", "--prefix", "/tmp/local prefix", "--no-save", "--ignore-scripts", "--global=false",
    "--package-lock=false", "--no-audit", "--no-fund", "archive.tgz",
  ], { maxBuffer: 4 * 1024 * 1024, shell: false }]]);
});

test("the real npm launcher supplies a local prefix and overrides global npm settings", { skip: process.platform === "win32" }, async (t) => {
  const { root, homeDirectory, betaPrefix: prefix } = await fixture(t);
  const fakeBin = join(root, "fake-bin");
  const capturePath = join(root, "captured-npm-arguments.txt");
  const archivePath = join(root, "vdoc-mcp-1.2.3-beta.1.tgz");
  const globalPrefix = join(homeDirectory, "npm-global");
  const globalMarker = join(globalPrefix, "global-package-marker.txt");
  const homeMarker = join(homeDirectory, "personal-marker.txt");
  const npmrc = join(homeDirectory, ".npmrc");
  await mkdir(fakeBin);
  await mkdir(globalPrefix);
  await writeFile(archivePath, "fake release archive\n");
  await writeFile(homeMarker, "keep home unchanged\n");
  await writeFile(globalMarker, "keep global unchanged\n");
  const configuration = `global=true\nprefix=${globalPrefix}\n`;
  await writeFile(npmrc, configuration);
  const fakeNpm = join(fakeBin, "npm");
  await writeFile(fakeNpm, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$VDOC_TEST_CAPTURE"\n');
  await chmod(fakeNpm, 0o755);

  execFileSync(process.execPath, ["--input-type=module", "-e", `
    const { defaultNpmInstall } = await import(process.env.VDOC_TEST_INSTALLER_URL);
    await defaultNpmInstall(process.env.VDOC_TEST_ARCHIVE, process.env.VDOC_TEST_PREFIX);
  `], {
    cwd: root,
    env: {
      ...process.env,
      PATH: fakeBin,
      HOME: homeDirectory,
      npm_config_global: "true",
      npm_config_prefix: globalPrefix,
      npm_config_userconfig: npmrc,
      VDOC_TEST_CAPTURE: capturePath,
      VDOC_TEST_INSTALLER_URL: new URL("../scripts/install-channel.mjs", import.meta.url).href,
      VDOC_TEST_ARCHIVE: archivePath,
      VDOC_TEST_PREFIX: prefix,
    },
    encoding: "utf8",
  });

  const args = (await readFile(capturePath, "utf8")).trimEnd().split("\n");
  assert.equal(args[0], "install");
  assert.equal(args.filter((arg) => arg === "--prefix").length, 1);
  assert.equal(args[args.indexOf("--prefix") + 1], prefix);
  for (const required of ["--global=false", "--no-save", "--ignore-scripts", archivePath]) {
    assert.ok(args.includes(required), `missing npm argument: ${required}`);
  }
  assert.equal(args.at(-1), archivePath);
  assert.ok(!args.some((arg) => ["--global", "-g", "--global=true", "--location=global"].includes(arg)));
  assert.equal(await readFile(homeMarker, "utf8"), "keep home unchanged\n");
  assert.equal(await readFile(globalMarker, "utf8"), "keep global unchanged\n");
  assert.equal(await readFile(npmrc, "utf8"), configuration);
  assert.deepEqual((await readdir(homeDirectory)).sort(), [".npmrc", "npm-global", "personal-marker.txt"]);
  assert.deepEqual(await readdir(globalPrefix), ["global-package-marker.txt"]);
});

test("an archive download failure never invokes npm", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const fetch = mockFetch([release("v1.2.3")], { assetStatus: 404 });
  const npm = mockNpmInstall();
  await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
  assert.equal(npm.calls.length, 0);
});

test("a selected release missing either installer metadata asset fails before downloads or prefix creation", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  for (const missingAsset of ["install-channel.mjs", "install-channel.mjs.sha256"]) {
    const selected = release("v0.3.15");
    selected.assets = selected.assets.filter((asset) => asset.name !== missingAsset);
    const fetch = mockFetch([selected]);
    const npm = mockNpmInstall();
    await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
    assert.equal(npm.calls.length, 0);
    assert.deepEqual(fetch.calls, [releasesURL], "incomplete release metadata must be rejected before downloading assets");
    await assert.rejects(readdir(prefix), { code: "ENOENT" }, "an incomplete release must not create a channel prefix");
  }
});

test("installer metadata assets must use the exact selected repository and tag URLs", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  for (const name of ["install-channel.mjs", "install-channel.mjs.sha256"]) {
    for (const url of [
      `https://evil.example/${name}`,
      `https://github.com/${repository}/releases/download/v9.0.0/${name}`,
      `https://github.com/other/repository/releases/download/v1.2.3/${name}`,
    ]) {
      const selected = release("v1.2.3");
      selected.assets.find((asset) => asset.name === name).browser_download_url = url;
      const fetch = mockFetch([selected]);
      const npm = mockNpmInstall();
      await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
      assert.equal(npm.calls.length, 0);
      assert.deepEqual(fetch.calls, [releasesURL], "untrusted installer metadata must be rejected before downloading assets");
      await assert.rejects(readdir(prefix), { code: "ENOENT" });
    }
  }
});

test("a historical stable package without its bundled installer fails before reporting success", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const fetch = mockFetch([release("v0.3.15")]);
  const npm = mockNpmInstall({ mutatePackage: (directory) => rm(join(directory, "scripts/install-channel.mjs")) });
  const messages = [];
  await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log: (message) => messages.push(message) }));
  assert.equal(npm.calls.length, 1);
  assert.ok(!messages.some((message) => /^Installed |^Update:/.test(message)), "an incomplete historical package must not report installation success or an unavailable update command");
  assert.equal((await marker(prefix)).channel, "release");
  assert.equal((await marker(prefix)).tag, undefined, "an incomplete package must not be recorded as successfully installed");
});

test("installed package version and complete Skill contents must match the chosen release", async (t) => {
  const { homeDirectory, releasePrefix: prefix } = await fixture(t);
  const fetch = mockFetch([release("v1.2.3")]);
  for (const mutatePackage of [
    (directory) => writeFile(join(directory, "package.json"), JSON.stringify({ name: "@vdoc/mcp", version: "9.0.0" })),
    (directory) => writeFile(join(directory, "package.json"), JSON.stringify({ name: "unrelated-package", version: "1.2.3" })),
    (directory) => rm(join(directory, "dist/index.js")),
    (directory) => rm(join(directory, "scripts/install-channel.mjs")),
    (directory) => rm(join(directory, "skills/vdoc/SKILL.md")),
    (directory) => rm(join(directory, "../../.bin/vdoc-mcp")),
  ]) {
    const npm = mockNpmInstall({ mutatePackage });
    await assert.rejects(installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} }));
    assert.equal(npm.calls.length, 1);
    assert.equal((await marker(prefix)).channel, "release");
  }
  const npm = mockNpmInstall();
  const result = await installChannel({ channel: "release", prefix, homeDirectory, fetchImpl: fetch.fetchImpl, npmInstall: npm.npmInstall, log() {} });
  assert.equal(result.tag, "v1.2.3", "a failed same-channel install remains retryable");
});
