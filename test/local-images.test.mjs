import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";

import sharp from "sharp";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { importMarkdownDocument } from "../dist/import-markdown.js";
import { MAX_IMAGE_BYTES, uploadLocalImage, validateLocalImage } from "../dist/local-images.js";
import { createVdocMCPServer } from "../dist/mcp-server.js";
import { packageVersion } from "../dist/version.js";

const commitID = "a".repeat(64);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const body = Buffer.concat([Buffer.from(type), data]); const head = Buffer.alloc(4), crc = Buffer.alloc(4); head.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body)); return Buffer.concat([head, body, crc]); }
function png(width = 1, height = 1) { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from([0, 127, 127, 127, 255]))), chunk("IEND", Buffer.alloc(0))]); }
const image = png();
const asset = `vdoc-asset:${hash(image)}`;
const tools = ["upload_document_image", "get_document_at_commit", "commit_changes"].map(name => ({ name, inputSchema: { type: "object" } }));

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "vdoc-markdown-images-")), calls = [];
  await mkdir(join(directory, "images"));
  await writeFile(join(directory, "images", "图 1.png"), image);
  const backend = http.createServer(async (req, res) => {
    const chunks = []; for await (const part of req) chunks.push(part);
    const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
    res.setHeader("X-Vdoc-Server-Version", packageVersion);
    let value;
    if (body.method === "tools/list") value = { tools: options.tools ?? tools };
    else if (body.params.name === "upload_document_image") {
      const content = Buffer.from(body.params.arguments.content_base64, "base64");
      value = { asset_id: hash(content), reference: `vdoc-asset:${hash(content)}`, filename: body.params.arguments.filename, content_type: "image/png", byte_length: content.length, width: 1, height: 1 };
    } else if (body.params.name === "get_document_at_commit") value = { commit_id: commitID, document: { document_id: "document", document_type: 2, name: "Original name", relative_path: "docs/original.md", description: "Keep metadata", content_hash: hash("original\r\n") }, content: "original\r\n" };
    else if (body.params.name === "commit_changes") value = { id: "b".repeat(64), version_name: "main.2" };
    else value = {};
    value = await options.mutate?.(body, value, res) ?? value;
    if (!res.destroyed) res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...(value.error ? value : { result: value }) }));
  });
  await new Promise(resolve => backend.listen(0, "127.0.0.1", resolve));
  const config = { endpointUrl: `http://127.0.0.1:${backend.address().port}/api/v1/open/mcp`, token: "fixture-images-only", requestTimeoutMs: 5000 };
  const server = createVdocMCPServer(config), client = new Client({ name: "image-regression", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
  t.after(async () => { await client.close(); await server.close(); backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const args = { project_id: "project", document_id: "document", branch_id: "branch", expected_head_commit_id: commitID, expected_generation: 2, idempotency_key: "same-import-key", file_path: join(directory, "source.md") };
  const save = async (source, changes = {}) => { await writeFile(args.file_path, source); return client.callTool({ name: "import_markdown_document", arguments: { ...args, ...changes } }); };
  return { directory, calls, config, client, args, save };
}
const parsed = result => { assert.notEqual(result.isError, true, result.content[0].text); return JSON.parse(result.content[0].text); };

for (const available of [[], [tools[0]], tools.slice(1), tools]) test(`image tool discovery follows backend capabilities (${available.map(x => x.name).join()})`, async t => {
  const f = await fixture(t, { tools: available }), discovered = (await f.client.listTools()).tools;
  assert.equal(discovered.some(x => x.name === "import_markdown_document"), available.length === 3);
  const upload = discovered.find(x => x.name === "upload_document_image");
  assert.equal(Boolean(upload), available.some(x => x.name === "upload_document_image"));
  if (upload) assert.ok(upload.inputSchema.properties.file_path);
});

test("uploads an explicit local file without forwarding its absolute path and preserves base64 calls", async t => {
  const f = await fixture(t), filePath = join(f.directory, "images", "图 1.png");
  const result = parsed(await f.client.callTool({ name: "upload_document_image", arguments: { project_id: "project", document_id: "document", file_path: filePath } }));
  assert.equal(result.reference, asset);
  assert.deepEqual(f.calls[0].params.arguments, { project_id: "project", document_id: "document", filename: "图 1.png", content_base64: image.toString("base64") });
  assert.equal(JSON.stringify(f.calls).includes(f.directory), false);
  parsed(await f.client.callTool({ name: "upload_document_image", arguments: { project_id: "project", document_id: "document", filename: "inline.png", content_base64: image.toString("base64") } }));
  assert.equal(f.calls[1].params.arguments.filename, "inline.png");
});

test("imports inline and reference images while preserving code, titles, CRLF, BOM and exact metadata", async t => {
  const f = await fixture(t);
  const source = '\ufeff# 标题\r\n\r\n![图](<images/图%201.png> "caption")\r\n![重复][Screen]\r\n\r\n[Screen]: <images/图%201.png> "定义标题"\r\n\r\n`![not](missing.png)`\r\n\r\n```md\r\n![not](also-missing.png)\r\n```\r\n\r\n[normal](keep.md)\r\n![external](https://example.com/image.png)\r\n![managed](' + asset + ')';
  const result = parsed(await f.save(source));
  assert.equal(result.uploaded_image_count, 1);
  assert.equal(result.replaced_image_destination_count, 2);
  assert.deepEqual(result.retained_external_image_urls, ["https://example.com/image.png"]);
  assert.deepEqual(f.calls.map(x => x.params?.name), ["get_document_at_commit", "upload_document_image", "commit_changes"]);
  const saved = f.calls[2].params.arguments;
  assert.deepEqual(saved, { project_id: "project", document_id: "document", branch_id: "branch", expected_head_commit_id: commitID, expected_generation: 2, idempotency_key: "same-import-key", changes: [{ operation: "upsert", document_id: "document", name: "Original name", relative_path: "docs/original.md", document_type: 2, description: "Keep metadata", content: source.replaceAll("images/图%201.png", asset) }] });
  assert.equal(JSON.stringify(f.calls).includes(f.directory), false);
  assert.deepEqual(await readFile(f.args.file_path, "utf8"), source);
});

test("shared reference definitions keep normal links intact; shortcut images and nested destinations are resolved", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "images", "a(b).png"), image);
  const source = '![nested [alt]](images/a(b).png)\n![shared][x] and [a link][x]\n![shortcut]\n\n[x]: images/a(b).png "Caption"\n[shortcut]: images/a(b).png\n[unused]: missing.png\n';
  parsed(await f.save(source));
  const saved = f.calls.find(x => x.params.name === "commit_changes").params.arguments.changes[0].content;
  assert.equal(saved, `![nested [alt]](${asset})\n![shared](${asset} "Caption") and [a link][x]\n![shortcut]\n\n[x]: images/a(b).png "Caption"\n[shortcut]: ${asset}\n[unused]: missing.png\n`);
  assert.equal(f.calls.filter(x => x.params.name === "upload_document_image").length, 1);
});

test("filesystem, image and parser validation finishes before any backend mutation", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "bad.png"), "not an image");
  await writeFile(join(f.directory, "truncated.png"), image.subarray(0, image.length - 2));
  await writeFile(join(f.directory, "huge.png"), Buffer.alloc(MAX_IMAGE_BYTES + 1));
  await writeFile(join(f.directory, "dimension.png"), png(100000, 100000));
  for (const [source, pattern] of [
    ['![ok](images/图%201.png)\n![missing](missing.png)', /ENOENT/],
    ['![x](../escape.png)', /directory|traversal/],
    ['![x](%2e%2e/escape.png)', /directory|traversal/],
    ['![x](/etc/passwd)', /directory|absolute/],
    ['![x](images)', /regular file/],
    ['![x](bad.png)', /PNG, JPEG, GIF or WebP/],
    ['![x](truncated.png)', /PNG/],
    ['![x](huge.png)', /4 MiB/],
    ['![x](dimension.png)', /40 million/],
    ['![x](images/a%ZZ.png)', /percent/],
    ['![x](images/a.png?raw=1)', /ambiguous/],
  ]) {
    f.calls.length = 0;
    const result = await f.save(source);
    assert.equal(result.isError, true, source); assert.match(result.content[0].text, pattern);
    assert.equal(f.calls.length, 0, source);
  }
  await writeFile(f.args.file_path, Buffer.from([0xff, 0xfe]));
  const invalidUTF8 = await f.client.callTool({ name: "import_markdown_document", arguments: f.args });
  assert.equal(invalidUTF8.isError, true); assert.match(invalidUTF8.content[0].text, /UTF-8/);
  assert.equal(f.calls.length, 0);
});

test("symlink files and symlink image directories are refused, including source symlinks", async t => {
  const f = await fixture(t);
  await symlink(join(f.directory, "images", "图 1.png"), join(f.directory, "linked.png"));
  await symlink(join(f.directory, "images"), join(f.directory, "linked-directory"));
  for (const source of ['![x](linked.png)', '![x](linked-directory/图%201.png)']) {
    const result = await f.save(source); assert.equal(result.isError, true); assert.match(result.content[0].text, /symlink/); assert.equal(f.calls.length, 0);
  }
  await symlink(f.args.file_path, join(f.directory, "alias.md"));
  const result = await f.client.callTool({ name: "import_markdown_document", arguments: { ...f.args, file_path: join(f.directory, "alias.md") } });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /symlink/); assert.equal(f.calls.length, 0);
});

test("remote, data, file and managed URLs never trigger local reads or HTTP image requests", async t => {
  const f = await fixture(t), source = `![a](https://example.com/a.png)\n![b](//example.com/b.png)\n![c](file:///etc/passwd)\n![d](data:image/png;base64,AAAA)\n![e](${asset})`;
  const result = parsed(await f.save(source));
  assert.equal(result.uploaded_image_count, 0); assert.equal(result.replaced_image_destination_count, 0);
  assert.equal(result.retained_external_image_urls.length, 4);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].params.arguments.changes[0].content, source);
});

test("snapshot integrity/type and remote permissions prevent uploads or a commit", async t => {
  for (const mutate of [
    (body, value) => body.params?.name === "get_document_at_commit" ? { ...value, document: { ...value.document, document_type: 1 } } : value,
    (body, value) => body.params?.name === "get_document_at_commit" ? { ...value, document: { ...value.document, content_hash: "0".repeat(64) } } : value,
    () => ({ error: { code: -32001, message: "Permission denied" } }),
  ]) {
    const f = await fixture(t, { mutate }), result = await f.save('![x](images/图%201.png)');
    assert.equal(result.isError, true); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].params.name, "get_document_at_commit");
  }
  const f = await fixture(t, { mutate: (body, value) => body.params?.name === "upload_document_image" ? { error: { code: -32001, message: "write scope denied" } } : value });
  const result = await f.save('![x](images/图%201.png)'); assert.equal(result.isError, true); assert.match(result.content[0].text, /scope denied/);
  assert.equal(f.calls.some(x => x.params.name === "commit_changes"), false);
});

test("backend hash mismatch is rejected before committing and REF_CONFLICT preserves the observed payload", async t => {
  const bad = await fixture(t, { mutate: (body, value) => body.params?.name === "upload_document_image" ? { ...value, reference: `vdoc-asset:${"0".repeat(64)}` } : value });
  const badResult = await bad.save('![x](images/图%201.png)'); assert.equal(badResult.isError, true); assert.match(badResult.content[0].text, /hash/); assert.equal(bad.calls.length, 2);
  const conflict = await fixture(t, { mutate: (body, value) => body.params?.name === "commit_changes" ? { error: { code: -32009, message: "REF_CONFLICT: HEAD moved" } } : value });
  const result = await conflict.save('![x](images/图%201.png)'); assert.equal(result.isError, true); assert.match(result.content[0].text, /REF_CONFLICT/);
  assert.equal(conflict.calls.at(-1).params.arguments.expected_head_commit_id, commitID);
  assert.equal(conflict.calls.at(-1).params.arguments.idempotency_key, "same-import-key");
});

test("retries after an unknown save result reuse identical commit bytes/key and changed files do not invent a new key", async t => {
  let loseFirstSave = true;
  const f = await fixture(t, { mutate: (body, value, response) => {
    if (body.params?.name === "commit_changes" && loseFirstSave) { loseFirstSave = false; response.destroy(); }
    return value;
  } });
  const unknown = await f.save('![x](images/图%201.png)');
  assert.equal(unknown.isError, true);
  parsed(await f.save('![x](images/图%201.png)'));
  parsed(await f.save('changed\n![x](images/图%201.png)'));
  const saves = f.calls.filter(x => x.params.name === "commit_changes").map(x => x.params.arguments);
  assert.deepEqual(saves[0], saves[1]); assert.equal(saves[2].idempotency_key, saves[0].idempotency_key);
  assert.notEqual(saves[2].changes[0].content, saves[0].changes[0].content);
});

test("invalid arguments and cancellation perform no backend calls", async t => {
  const f = await fixture(t); await writeFile(f.args.file_path, "# source");
  for (const change of [{ file_path: "relative.md" }, { expected_generation: 2.5 }, { idempotency_key: "short" }, { expected_head_commit_id: "main" }, { overwrite: true }]) {
    await assert.rejects(importMarkdownDocument(f.config, { ...f.args, ...change }));
  }
  await assert.rejects(importMarkdownDocument(f.config, f.args, AbortSignal.abort(new Error("cancel import"))), /cancel import/);
  await assert.rejects(uploadLocalImage(f.config, { project_id: "p", document_id: "d", file_path: join(f.directory, "images", "图 1.png") }, AbortSignal.abort(new Error("cancel image"))), /cancel image/);
  for (const input of [{ project_id: "p", document_id: "d", file_path: "relative.png" }, { project_id: "p", document_id: "d", filename: "x.png", content_base64: "not base64" }, { project_id: "p", document_id: "d", file_path: f.args.file_path, filename: "x.png" }]) await assert.rejects(uploadLocalImage(f.config, input));
  assert.equal(f.calls.length, 0);
});

test("media preflight rejects corrupt PNG data and supports a complete GIF", async () => {
  assert.equal((await validateLocalImage(image)).contentType, "image/png");
  const corrupt = Buffer.from(image); corrupt[45] ^= 0xff;
  await assert.rejects(validateLocalImage(corrupt), /PNG|png|checksum/);
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  assert.equal((await validateLocalImage(gif)).contentType, "image/gif");
  await assert.rejects(validateLocalImage(gif.subarray(0, gif.length - 1)), /GIF/);
});

test("cancellation after an image upload cannot submit the Markdown commit", async t => {
  const controller = new AbortController();
  const f = await fixture(t, { mutate: (body, value) => { if (body.params?.name === "upload_document_image") controller.abort(new Error("stop import after upload")); return value; } });
  await writeFile(f.args.file_path, '![x](images/图%201.png)');
  await assert.rejects(importMarkdownDocument(f.config, f.args, controller.signal), /cancelled|stop import/);
  assert.equal(f.calls.some(x => x.params.name === "upload_document_image"), true);
  assert.equal(f.calls.some(x => x.params.name === "commit_changes"), false);
});

test("concrete tokens preserve image alt code spans, nested links and escaped URL punctuation", async t => {
  const f = await fixture(t);
  await writeFile(join(f.directory, "images", "a(b).png"), image);
  const source = '![alt `]` code](images/图%201.png)\n![outer [link](not-an-image.md)](images/a\\(b\\).png)\n![ref `]`][x] and [normal][x]\n\n[x]: images/a(b).png "title"\n';
  parsed(await f.save(source));
  const saved = f.calls.at(-1).params.arguments.changes[0].content;
  assert.equal(saved, `![alt \`]\` code](${asset})\n![outer [link](not-an-image.md)](${asset})\n![ref \`]\`](${asset} "title") and [normal][x]\n\n[x]: images/a(b).png "title"\n`);
  assert.equal(f.calls.filter(x => x.params.name === "upload_document_image").length, 1);
});


test("corrupt PNG compressed pixels with valid chunk CRC fail before any remote mutation", async t => {
  const f = await fixture(t), corrupt = Buffer.from(image);
  let offset = 8;
  while (offset < corrupt.length) {
    const length = corrupt.readUInt32BE(offset);
    if (corrupt.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      corrupt[offset + 8] = 0; corrupt[offset + 9] = 0;
      corrupt.writeUInt32BE(crc32(corrupt.subarray(offset + 4, offset + 8 + length)), offset + 8 + length);
      break;
    }
    offset += 12 + length;
  }
  await assert.rejects(validateLocalImage(corrupt), /PNG.*decode failed/);
  await writeFile(join(f.directory, "corrupt-pixels.png"), corrupt);
  const result = await f.save('![good](images/图%201.png)\n![bad](corrupt-pixels.png)');
  assert.equal(result.isError, true); assert.match(result.content[0].text, /PNG.*decode failed/);
  assert.equal(f.calls.length, 0);
});

test("full local decoders accept supported codecs and reject bounded animated or corrupt pixel streams", async () => {
  for (const format of ["png", "jpeg", "gif", "webp"]) {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).toFormat(format).toBuffer();
    const validated = await validateLocalImage(bytes);
    assert.equal(validated.contentType, `image/${format}`); assert.equal(validated.width, 2); assert.equal(validated.height, 2);
  }
  const tinyGIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
  const animated = Buffer.concat([tinyGIF.subarray(0, 19), ...Array.from({ length: 1001 }, () => tinyGIF.subarray(19, 33)), Buffer.from([0x3b])]);
  await assert.rejects(validateLocalImage(animated), /1000 frames/);
  const webp = Buffer.alloc(26);
  webp.write("RIFF"); webp.writeUInt32LE(18, 4); webp.write("WEBPVP8L", 8); webp.writeUInt32LE(5, 16); webp[20] = 0x2f;
  await assert.rejects(validateLocalImage(webp), /WEBP.*decode failed/);
});

test("many different filenames for identical images reuse one validated upload and stable reference", async t => {
  const f = await fixture(t), names = Array.from({ length: 120 }, (_, i) => `copy-${i}.png`);
  for (const name of names) await writeFile(join(f.directory, name), image);
  const result = parsed(await f.save(names.map(name => `![alias](${name})`).join("\n")));
  assert.equal(result.uploaded_image_count, 1);
  assert.equal(result.replaced_image_destination_count, names.length);
  assert.equal(f.calls.filter(x => x.params.name === "upload_document_image").length, 1);
  const content = f.calls.at(-1).params.arguments.changes[0].content;
  assert.equal(content, names.map(() => `![alias](${asset})`).join("\n"));
});

test("animated WebP is rejected during preflight before earlier valid images can upload", async t => {
  const f = await fixture(t);
  const animated = await readFile(new URL("fixtures/animated.webp", import.meta.url));
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  await assert.rejects(validateLocalImage(animated), /Animated WebP is not supported.*GIF or a static WebP/);
  await writeFile(join(f.directory, "animated.webp"), animated);
  const result = await f.save('![valid](images/图%201.png)\n![animation](animated.webp)');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Animated WebP is not supported/);
  assert.equal(f.calls.length, 0);
});
