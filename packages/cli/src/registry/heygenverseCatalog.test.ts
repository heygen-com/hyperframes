import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  THREAD_MESSAGE_STACK_ARTIFACT_ID,
  THREAD_MESSAGE_STACK_CANONICAL_URI,
  THREAD_MESSAGE_STACK_VERSION_ID,
  assertHeyGenVerseSourceDigest,
  parseHeyGenVerseCatalogProjection,
} from "./heygenverseCatalog.js";

const projectionPath = resolve(
  import.meta.dirname,
  "../../../../registry/heygenverse-catalog.json",
);
const itemPath = resolve(
  import.meta.dirname,
  "../../../../registry/blocks/thread-message-stack/registry-item.json",
);
const sourcePath = resolve(
  import.meta.dirname,
  "../../../../registry/blocks/thread-message-stack/thread-message-stack.html",
);

describe("HeyGenVerse catalog projection", () => {
  it("preserves the canonical artifact/version identity and immutable digest", () => {
    const projection = parseHeyGenVerseCatalogProjection(readFileSync(projectionPath, "utf8"));
    expect(projection.artifactId).toBe(THREAD_MESSAGE_STACK_ARTIFACT_ID);
    expect(projection.versionId).toBe(THREAD_MESSAGE_STACK_VERSION_ID);
    expect(projection.canonicalUri).toBe(THREAD_MESSAGE_STACK_CANONICAL_URI);
    expect(projection.records).toEqual([
      expect.objectContaining({ name: "thread-message-stack", type: "hyperframes:block" }),
    ]);
  });

  it("rejects missing, altered, or divergent provenance", () => {
    const source = JSON.parse(readFileSync(projectionPath, "utf8")) as Record<string, unknown>;
    expect(() =>
      parseHeyGenVerseCatalogProjection(JSON.stringify({ ...source, versionId: "changed" })),
    ).toThrow(/version/);
    expect(() =>
      parseHeyGenVerseCatalogProjection(JSON.stringify({ ...source, catalogDigest: "sha256:00" })),
    ).toThrow(/digest/);
    expect(() =>
      parseHeyGenVerseCatalogProjection(JSON.stringify({ ...source, artifactId: undefined })),
    ).toThrow(/artifact/);
  });

  it("rejects source bytes that diverge from the projected immutable digest", () => {
    const item = JSON.parse(readFileSync(itemPath, "utf8"));
    const source = readFileSync(sourcePath, "utf8");
    expect(() => assertHeyGenVerseSourceDigest(item, source)).not.toThrow();
    expect(() => assertHeyGenVerseSourceDigest(item, `${source}\nchanged`)).toThrow(
      /source digest/,
    );
  });
});
