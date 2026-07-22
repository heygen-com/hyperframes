import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const binPath = fileURLToPath(new URL("../bin/hyperframes.mjs", import.meta.url));

describe.skipIf(process.platform === "win32")("CLI bin", () => {
  it("marks the package bin target as executable", () => {
    expect(statSync(binPath).mode & 0o111).not.toBe(0);
  });
});
