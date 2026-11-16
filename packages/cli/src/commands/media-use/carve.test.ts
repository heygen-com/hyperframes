import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCarveScript } from "./carve.js";

describe("resolveCarveScript", () => {
  it("finds the carve script at the repo root from the source tree", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    expect(resolveCarveScript(here)).toBe(
      join(here, "../../../../..", "skills/media-use/audio/scripts/carve.mjs"),
    );
  });

  it("finds the copy shipped next to the built bundle", () => {
    const dist = mkdtempSync(join(tmpdir(), "hf-carve-dist-"));
    try {
      const script = join(dist, "skills/media-use/audio/scripts/carve.mjs");
      mkdirSync(dirname(script), { recursive: true });
      writeFileSync(script, "");
      expect(resolveCarveScript(dist)).toBe(script);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it("says the build is missing the script rather than looking anywhere else", () => {
    expect(() => resolveCarveScript("/nowhere", () => false)).toThrow(
      /missing from this CLI build/,
    );
  });
});
