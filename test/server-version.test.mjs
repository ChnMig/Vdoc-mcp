import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseServerVersion } from "../dist/server-version.js";

test("version comparison includes prerelease and build labels and normalizes v prefixes", () => {
  for (const version of ["1.2.3", "0.4.0-beta.6", "1.2.3+build.4"]) {
    assert.equal(diagnoseServerVersion(version, ` v${version} `), undefined);
  }
  for (const server of ["0.4.0-beta.5", "0.4.0", "0.4.1-beta.6"]) {
    const warning = diagnoseServerVersion("0.4.0-beta.6", server);
    assert.equal(warning.code, "version_mismatch");
    assert.equal(warning.serverVersion, server);
    assert.match(warning.message, /MCP client 0\.4\.0-beta\.6/);
    assert.ok(warning.message.includes(`server ${server}`));
  }
});

test("missing and untrusted server versions cannot be mistaken for matches or echoed", () => {
  for (const value of [null, "", "dev", "unknown", "01.2.3", "<secret>", "1.2.3\nforged warning", "a".repeat(257)]) {
    const warning = diagnoseServerVersion("0.4.0-beta.6", value);
    assert.equal(warning.code, "server_version_unknown");
    assert.equal(warning.serverVersion, undefined);
    assert.doesNotMatch(warning.message, /<secret>|forged warning/);
  }
});
