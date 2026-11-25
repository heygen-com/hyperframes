import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  it.skipIf(process.platform === "win32")(
    "never writes through a link at the entry or in place of its folders, and reads no linked entry",
    () => {
      const project = join(dir, "project");
      const outside = join(dir, "outside");
      const cache = join(project, ".hyperframes", "audio-kind");
      mkdirSync(cache, { recursive: true });
      mkdirSync(outside);
      const victim = join(outside, "victim.json");
      writeFileSync(victim, JSON.stringify(kind));
      const entry = join(cache, "entry.json");
      symlinkSync(victim, entry);
      expect(readKindCache(entry)).toBeNull();
      expect(writeKindCache(entry, { ...kind, value: "voice" })).toBeNull();
      expect(JSON.parse(readFileSync(victim, "utf8")).value).toBe("music");
      expect(lstatSync(entry).isFile()).toBe(true);

      rmSync(cache, { recursive: true });
      symlinkSync(outside, cache);
      expect(writeKindCache(join(cache, "other.json"), kind)).toMatch(/could not be cached/);
      expect(readdirSync(outside)).toEqual(["victim.json"]);
    },
  );

  it.skipIf(process.platform === "win32")(
    "reads no entry through a link in place of .hyperframes or audio-kind",
    () => {
      const outside = join(dir, "linked-outside");
      mkdirSync(join(outside, "audio-kind"), { recursive: true });
      writeFileSync(join(outside, "entry.json"), JSON.stringify(kind));
      writeFileSync(join(outside, "audio-kind", "entry.json"), JSON.stringify(kind));
      expect(readKindCache(join(outside, "entry.json"))).not.toBeNull();

      const linkedKind = join(dir, "linked-kind", ".hyperframes");
      mkdirSync(linkedKind, { recursive: true });
      symlinkSync(outside, join(linkedKind, "audio-kind"));
      expect(readKindCache(join(linkedKind, "audio-kind", "entry.json"))).toBeNull();

      const linkedRecords = join(dir, "linked-records");
      mkdirSync(linkedRecords);
      symlinkSync(outside, join(linkedRecords, ".hyperframes"));
      expect(
        readKindCache(join(linkedRecords, ".hyperframes", "audio-kind", "entry.json")),
      ).toBeNull();
    },
  );
});
