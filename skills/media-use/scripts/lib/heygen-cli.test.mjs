import { strict as assert } from "node:assert";
import { test } from "node:test";
import { classifyHeygenError } from "./heygen-cli.mjs";

test("classifies ENOENT-style missing heygen errors with install instructions", () => {
  const message = classifyHeygenError({ code: "ENOENT", message: "spawn heygen ENOENT" });

  assert.equal(
    message,
    "media-use: heygen CLI not found — it's the free path for bgm/image/voice/avatar-video. Install: curl -fsSL https://static.heygen.ai/cli/install.sh | bash  then  heygen auth login --key <key>",
  );
});

test("classifies auth failures with login instructions", () => {
  const message = classifyHeygenError({ stderr: Buffer.from("Error: not logged in") });

  assert.equal(
    message,
    "media-use: heygen CLI not authenticated (free usage) — run: heygen auth login --key <key>",
  );
});

test("classifies old heygen versions with update instructions", () => {
  const message = classifyHeygenError({
    stderr: Buffer.from("heygen v0.1.5 does not support --headers"),
  });

  assert.equal(message, "media-use: heygen CLI is outdated — run: heygen update  (need >= v0.1.6)");
});

test("passes through unrelated errors", () => {
  const message = classifyHeygenError({
    stderr: Buffer.from("rate limit exceeded"),
    message: "Command failed",
  });

  assert.equal(message, "rate limit exceeded");
});
