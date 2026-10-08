import assert from "node:assert/strict";
import test from "node:test";

import { redactRPCErrorData, redactSecrets } from "../dist/sanitize.js";

test("redactSecrets removes Vdoc token values", () => {
  assert.equal(redactSecrets("failed for vdoc_secret_123"), "failed for vdoc_[redacted]");
});

test("redactSecrets removes authorization header values", () => {
  assert.equal(
    redactSecrets({ authorization: "vdoc_secret_123" }),
    '{"authorization":"[redacted]"}',
  );
});

test("redactSecrets removes full bearer authorization header text", () => {
  assert.equal(
    redactSecrets("Authorization: Bearer abc.def.ghi"),
    "Authorization: [redacted]",
  );
});

test("redactSecrets removes JSON bearer authorization values", () => {
  assert.equal(
    redactSecrets('{"authorization":"Bearer abc.def.ghi"}'),
    '{"authorization":"[redacted]"}',
  );
});

test("redactSecrets handles non-JSON error values without a second failure", () => {
  assert.equal(redactSecrets(undefined), "undefined");
  assert.equal(redactSecrets(Symbol("vdoc_secret_123")), "Symbol(vdoc_[redacted])");
  assert.equal(redactSecrets(1n), "1");
  assert.equal(typeof redactSecrets(() => {}), "string");
  const unprintable = { toJSON() { throw new Error("cannot serialize"); }, toString() { throw new Error("cannot stringify"); } };
  assert.equal(redactSecrets(unprintable), "[unprintable error]");
});

test("RPC error data is copied with nested credentials removed and JSON types preserved", () => {
  const token = "fixture.token+$[synthetic]";
  const original = JSON.parse(`{"__proto__":{"safe":true},"status":"FAILED_PRECONDITION","code":400,"retry":false,"empty":null}`);
  original.detail = `rejected ${token}; vdoc_other_synthetic`;
  original.items = [17, true, null, [], {}, { AuThOrIzAtIoN: { private: "Bearer synthetic.jwt" }, note: `token ${token}` }];
  original[`key-${token}`] = "safe value";
  const before = JSON.stringify(original);
  const result = redactRPCErrorData(original, token);
  assert.equal(JSON.stringify(original), before, "the upstream object must remain unchanged");
  assert.notEqual(result, original);
  assert.notEqual(result.items, original.items);
  assert.notEqual(result.items[5], original.items[5]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.deepEqual(result.__proto__, { safe: true });
  assert.deepEqual(result.items, [17, true, null, [], {}, { AuThOrIzAtIoN: "[redacted]", note: "token [redacted]" }]);
  assert.equal(result.detail, "rejected [redacted]; vdoc_[redacted]");
  assert.equal(result["key-[redacted]"], "safe value");
  assert.equal(result.status, "FAILED_PRECONDITION");
  assert.equal(result.code, 400);
  assert.equal(result.retry, false);
  assert.equal(result.empty, null);
});

test("RPC error data preserves primitive and moderately sized diagnostic values", () => {
  for (const value of [undefined, null, true, false, 0, 400, "safe diagnostic"]) {
    assert.equal(redactRPCErrorData(value, ""), value);
  }
  const text = "safe diagnostic ".repeat(4096);
  assert.equal(redactRPCErrorData(text), text);
  assert.equal(redactSecrets("first literal+$[token] then literal+$[token]", "literal+$[token]"), "first [redacted] then [redacted]");
});

test("RPC error sanitization traverses deeply nested JSON without recursive calls", () => {
  const original = {};
  let current = original;
  for (let depth = 0; depth < 20000; depth += 1) {
    current.next = {};
    current = current.next;
  }
  current.detail = "vdoc_deep_synthetic";
  current.Authorization = "Bearer synthetic.jwt";
  let copied = redactRPCErrorData(original);
  for (let depth = 0; depth < 20000; depth += 1) copied = copied.next;
  assert.equal(copied.detail, "vdoc_[redacted]");
  assert.equal(copied.Authorization, "[redacted]");
  assert.equal(current.detail, "vdoc_deep_synthetic");
});
