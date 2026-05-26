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
