import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { downloadDocumentAtCommit } from "../dist/download-document.js";
import { createVdocMCPServer } from "../dist/mcp-server.js";
import { packageVersion } from "../dist/version.js";

const commit = "b".repeat(64);
const hash = text => createHash("sha256").update(text).digest("hex");
const readTool = { name: "get_document_at_commit", inputSchema: { type: "object" } };

async function fixture(t, source = "# 原始文档\r\n", mutate = value => value, tools = [readTool]) {
  const root = await mkdtemp(join(tmpdir(), "vdoc-source-download-"));
  const calls = [];
  const backend = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    calls.push(body);
    assert.equal(req.headers.authorization, "fixture-download-token");
    res.setHeader("X-Vdoc-Server-Version", packageVersion);
    const value = body.method === "tools/list"
      ? { tools }
      : mutate({ commit_id: commit, document: { document_id: "document", relative_path: "../../untrusted-name.md", content_hash: hash(source) }, content: source });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...(value.error ? value : { result: value }) }));
  });
  await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
  const config = { endpointUrl: `http://127.0.0.1:${backend.address().port}/api/v1/open/mcp`, token: "fixture-download-token", requestTimeoutMs: 5000 };
  const server = createVdocMCPServer(config);
  const client = new Client({ name: "download-regression", version: "1" });
  t.after(async () => {
    await client.close();
    await server.close();
    backend.closeAllConnections();
    await new Promise(resolve => backend.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  const args = { project_id: "project", document_id: "document", commit_id: commit, output_path: join(root, "下载", "original.md") };
  const download = (input = args) => client.callTool({ name: "download_document_at_commit", arguments: input });
  return { root, config, client, calls, args, download };
}

test("local download discovery requires backend commit-content support and declares its filesystem side effect", async t => {
  for (const tools of [[], [readTool], [readTool, { name: "download_document_at_commit", inputSchema: { type: "object" } }]]) {
    const f = await fixture(t, "", undefined, tools);
    const found = (await f.client.listTools()).tools.filter(tool => tool.name === "download_document_at_commit");
    assert.equal(found.length, tools.length === 0 ? 0 : 1);
    if (found.length) {
      assert.equal(found[0].annotations.readOnlyHint, false);
      assert.equal(found[0].annotations.destructiveHint, false);
      assert.ok(found[0].inputSchema.required.includes("output_path"));
    }
  }
});

for (const [extension, source] of [
  ["md", "\uFEFF# 中文原文\r\n\r\nemoji 📝 与空格  \r\n"],
  ["yaml", "openapi: 3.1.0\r\n# keep this comment\r\ninfo: {title: 测试, version: '1'}\r\n"],
  ["json", '{ "openapi": "3.1.0", "example": 9007199254740993, "ratio": 0.123456789012345678901 }\n'],
  ["txt", "literal <tag> & \\ text\nno trailing newline"],
  ["txt", ""],
]) {
  test(`downloads exact ${extension} source bytes without reformatting (${Buffer.byteLength(source)} bytes)`, async t => {
    const f = await fixture(t, source);
    f.args.output_path = join(f.root, "下载", `original.${extension}`);
    const result = await f.download();
    assert.notEqual(result.isError, true, result.content[0].text);
    const saved = JSON.parse(result.content[0].text);
    assert.deepEqual(await readFile(saved.file_path), Buffer.from(source));
    assert.deepEqual(saved, { file_path: f.args.output_path, byte_length: Buffer.byteLength(source), sha256: hash(source), commit_id: commit, document_id: "document" });
    assert.deepEqual(f.calls[0].params, { name: "get_document_at_commit", arguments: { project_id: "project", document_id: "document", commit_id: commit } });
    assert.equal(JSON.stringify(f.calls).includes(f.args.output_path), false);
    assert.deepEqual(await readdir(dirname(f.args.output_path)), [`original.${extension}`]);
    if (process.platform !== "win32") assert.equal((await lstat(saved.file_path)).mode & 0o777, 0o600);
  });
}

test("existing files, directories and symlinks are never replaced, including a concurrent destination", async t => {
  const f = await fixture(t);
  await mkdir(dirname(f.args.output_path), { recursive: true });
  await writeFile(f.args.output_path, "user edits");
  let result = await f.download();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /already exists/);
  assert.equal(await readFile(f.args.output_path, "utf8"), "user edits");
  await rm(f.args.output_path);
  await mkdir(f.args.output_path);
  result = await f.download();
  assert.equal(result.isError, true);
  assert.ok((await lstat(f.args.output_path)).isDirectory());
  await rm(f.args.output_path, { recursive: true });
  if (process.platform !== "win32") {
    const target = join(f.root, "keep.txt");
    await writeFile(target, "keep");
    await symlink(target, f.args.output_path);
    result = await f.download();
    assert.equal(result.isError, true);
    assert.ok((await lstat(f.args.output_path)).isSymbolicLink());
    assert.equal(await readFile(target, "utf8"), "keep");
  }
  assert.deepEqual(await readdir(dirname(f.args.output_path)), ["original.md"]);

  const competing = await Promise.all([f.download({ ...f.args, output_path: join(f.root, "race.txt") }), f.download({ ...f.args, output_path: join(f.root, "race.txt") })]);
  assert.equal(competing.filter(item => item.isError !== true).length, 1);
  assert.equal(await readFile(join(f.root, "race.txt"), "utf8"), "# 原始文档\r\n");
  assert.equal((await readdir(f.root)).some(name => name.startsWith(".vdoc-download-")), false);
});

test("invalid arguments and pre-cancelled requests never contact the backend or create files", async t => {
  const f = await fixture(t);
  for (const change of [{ output_path: "relative.md" }, { commit_id: "main" }, { project_id: "" }, { document_id: null }, { output_path: "\0bad" }, { overwrite: true }]) {
    const result = await f.download({ ...f.args, ...change });
    assert.equal(result.isError, true, JSON.stringify(change));
  }
  await assert.rejects(downloadDocumentAtCommit(f.config, f.args, AbortSignal.abort(new Error("cancel download"))), /cancel download/);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readdir(f.root), []);
});

test("permission errors, corrupt hashes, wrong snapshots and oversized content leave no local output", async t => {
  const cases = [
    [value => ({ ...value, document: { ...value.document, content_hash: "0".repeat(64) } }), /SHA-256/],
    [value => ({ ...value, commit_id: "a".repeat(64) }), /different document\/commit/],
    [value => ({ ...value, document: { ...value.document, document_id: "other" } }), /different document\/commit/],
    [value => ({ ...value, content: null }), /invalid download/],
    [() => ({ error: { code: -32001, message: "permission denied" } }), /permission denied/],
  ];
  for (const [mutate, pattern] of cases) {
    const f = await fixture(t, "source", mutate);
    const result = await f.download();
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, pattern);
    assert.deepEqual(await readdir(f.root), []);
  }
  const large = await fixture(t, "x".repeat(10 * 1024 * 1024 + 1));
  const result = await large.download();
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /10 MiB/);
  assert.deepEqual(await readdir(large.root), []);
});
