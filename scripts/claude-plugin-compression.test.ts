import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_INSTALL_COMPRESSION_RATIO = 50;

const CLAUDE_PLUGIN_PAYLOAD_FILES = [
  "packages/producer/tests/missing-host-comp-id/src/silence.wav",
] as const;

function compressionRatio(bytes: Buffer): number {
  const compressedBytes = deflateRawSync(bytes).byteLength;
  return bytes.byteLength / compressedBytes;
}

describe("Claude plugin install payload", () => {
  it("keeps bundled files below the suspicious compression-ratio guard", () => {
    for (const relativePath of CLAUDE_PLUGIN_PAYLOAD_FILES) {
      const bytes = readFileSync(resolve(REPO_ROOT, relativePath));
      const ratio = compressionRatio(bytes);

      assert.ok(
        ratio <= MAX_INSTALL_COMPRESSION_RATIO,
        `${relativePath} compresses at ${ratio.toFixed(1)}:1, above the ${MAX_INSTALL_COMPRESSION_RATIO}:1 install guard`,
      );
    }
  });
});
