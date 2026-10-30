import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readKindCache, writeKindCache } from "./kindCache.js";

const dir = mkdtempSync(join(tmpdir(), "hf-kind-cache-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const kind = {
  value: "music" as const,
  confidence: 0.8,
  features: { duration: 20, regularity: 0.3, syllables: 0.1, sustain: 1 },
};

describe("kind cache", () => {
  it("reconstructs successful signal evidence without retaining temporary files", () => {
    const file = join(dir, "good.json");
    expect(writeKindCache(file, kind)).toBeNull();
    expect(readKindCache(file)).toEqual({
      analyzed: 20,
      values: { kind },
      provenance: { kind: "signal" },
      ladder: { kind: [{ provider: "signal", outcome: "answered" }] },
      warnings: [],
    });
    expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it.each(["{", "null", "{}", '{"value": "voice", "confidence": 1, "features": {}}'])(
    "ignores incomplete or corrupt cached JSON %s",
    (json) => {
      const file = join(dir, "bad.json");
      writeFileSync(file, json);
      expect(readKindCache(file)).toBeNull();
    },
  );

  it("treats absent entries as misses and reports unwritable destinations without throwing", () => {
    expect(readKindCache(join(dir, "absent.json"))).toBeNull();
    const blocked = join(dir, "not-a-directory");
    writeFileSync(blocked, "file");
    expect(writeKindCache(join(blocked, "entry.json"), kind)).toMatch(/could not be cached/);
  });
});
