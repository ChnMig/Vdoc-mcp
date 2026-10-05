import assert from "node:assert/strict";
import test from "node:test";

import { redactSecrets } from "../dist/sanitize.js";

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
