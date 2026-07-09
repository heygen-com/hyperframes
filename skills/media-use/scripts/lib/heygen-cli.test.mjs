import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  classifyHeygenError,
  HEYGEN_NOT_AUTHENTICATED_MESSAGE,
  HEYGEN_NOT_FOUND_MESSAGE,
  HEYGEN_OUTDATED_MESSAGE,
} from "./heygen-cli.mjs";

test("classifies ENOENT-style missing heygen errors with install instructions", () => {
  const message = classifyHeygenError({ code: "ENOENT", message: "spawn heygen ENOENT" });

  assert.equal(message, HEYGEN_NOT_FOUND_MESSAGE);
});

test("classifies auth failures with login instructions", () => {
  const message = classifyHeygenError({ stderr: Buffer.from("Error: not logged in") });

  assert.equal(message, HEYGEN_NOT_AUTHENTICATED_MESSAGE);
});

test("classifies a real 401 as auth, but not a bare 401 substring in prose", () => {
  assert.equal(
    classifyHeygenError({ stderr: Buffer.from("HTTP 401 Unauthorized") }),
    HEYGEN_NOT_AUTHENTICATED_MESSAGE,
  );
  // A request id that merely contains "401" must NOT read as an auth failure.
  const noise = classifyHeygenError({ stderr: Buffer.from("upload failed (request req-401abc)") });
  assert.notEqual(noise, HEYGEN_NOT_AUTHENTICATED_MESSAGE);
});

test("classifies old heygen versions with update instructions", () => {
  const message = classifyHeygenError({
    stderr: Buffer.from("heygen v0.1.5 does not support --headers"),
  });

  assert.equal(message, HEYGEN_OUTDATED_MESSAGE);
});

test("does not misclassify a resource 'not found' error as a missing CLI", () => {
  // A stale voiceId makes `heygen voice speech create` fail with "voice not
  // found"; the error message embeds the `heygen ...` command line. This must
  // pass through as detail, not send the user to reinstall a working CLI.
  const message = classifyHeygenError({
    stderr: Buffer.from("Error: voice not found (id: stale-123)"),
    message: "Command failed: heygen voice speech create --voice stale-123",
  });

  assert.notEqual(message, HEYGEN_NOT_FOUND_MESSAGE);
  assert.equal(message, "Error: voice not found (id: stale-123)");
});

test("classifies a shell 'command not found' as a missing CLI", () => {
  const message = classifyHeygenError({ stderr: Buffer.from("bash: heygen: command not found") });

  assert.equal(message, HEYGEN_NOT_FOUND_MESSAGE);
});

test("passes through unrelated errors", () => {
  const message = classifyHeygenError({
    stderr: Buffer.from("rate limit exceeded"),
    message: "Command failed",
  });

  assert.equal(message, "rate limit exceeded");
});
