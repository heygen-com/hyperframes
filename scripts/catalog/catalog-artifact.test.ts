import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildArtifact,
  LOCAL_VECTOR_BATCH_SIZE,
  localVectorRevision,
  MANIFEST_SCHEMA_VERSION,
  movesMissingFromRegistry,
  parseShelf,
  payloadDigest,
  sha256Hex,
  sortedNames,
  verifyArtifact,
  type Embedder,
} from "./catalog-artifact.js";

const REVISION = "00dda8f35dac0b89defe438d465cfe3d9d941b4f";
const MODEL = "text-embedding-3-small";

const SHELF = `# Video primitive shelf

Preamble that is not an entry.

### beta-move

group: Annotation.
what: Second alphabetically, first in the document.
use_when: A callout needs to land.
avoid_when: The shot is already busy.
notes: Not a retrieval field.

### alpha-move

group: Motion.
what: First alphabetically, second in the document.
use_when: Pace needs to lift.
avoid_when: Motion would distract.
`;

/** Deterministic stand-in so no test makes a paid call. */
const fakeEmbed =
  (dimension = 4): Embedder =>
  async (texts) =>
    texts.map((text, index) => Array.from({ length: dimension }, (_, i) => (index + 1) / (i + 2)));

async function build(overrides: Partial<Parameters<typeof buildArtifact>[0]> = {}) {
  return buildArtifact({
    shelfText: SHELF,
    sourceRevision: REVISION,
    embeddingModel: MODEL,
    embed: fakeEmbed(),
    ...overrides,
  });
}

describe("shelf contract", () => {
  it("keys entries by move name and ignores the preamble", () => {
    const entries = parseShelf(SHELF);
    expect([...entries.keys()].sort()).toEqual(["alpha-move", "beta-move"]);
    expect(JSON.stringify([...entries.values()])).not.toContain("Preamble");
  });

  it("excludes the move name from its own retrieval text", () => {
    // Including the name would let a move win on its own label, which is what
    // lexical ranking already does.
    for (const [name, text] of parseShelf(SHELF)) expect(text).not.toContain(name);
  });

  it("keeps only the four evaluated fields", () => {
    expect(parseShelf(SHELF).get("beta-move")?.split("\n")).toEqual([
      "group: Annotation.",
      "what: Second alphabetically, first in the document.",
      "use_when: A callout needs to land.",
      "avoid_when: The shot is already busy.",
    ]);
  });

  it("orders embedding by name, not document order", () => {
    expect(sortedNames(parseShelf(SHELF))).toEqual(["alpha-move", "beta-move"]);
  });

  it("rejects a duplicate move name", () => {
    expect(() => parseShelf(`${SHELF}\n### beta-move\n\ngroup: Repeat.\n`)).toThrow(
      /Duplicate move name/,
    );
  });

  it("rejects a shelf with no entries", () => {
    expect(() => parseShelf("# Heading only\n\nProse.\n")).toThrow(/no entries/);
  });
});

describe("build contract", () => {
  it("publishes descriptions and vectors covering the same moves", async () => {
    const { catalogBytes, vectorsBytes, manifest } = await build();
    const catalog = JSON.parse(catalogBytes.toString("utf-8"));
    const vectors = JSON.parse(vectorsBytes.toString("utf-8"));
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(vectors).sort());
    expect(manifest.move_count).toBe(2);
    expect(manifest.embedding_model).toBe(MODEL);
    expect(manifest.schema_version).toBe(MANIFEST_SCHEMA_VERSION);
  });

  it("rebuilds byte-identically from an unchanged shelf", async () => {
    const first = await build();
    const second = await build();
    expect(first.catalogBytes.equals(second.catalogBytes)).toBe(true);
    expect(first.vectorsBytes.equals(second.vectorsBytes)).toBe(true);
    expect(first.manifest.payload_sha256).toBe(second.manifest.payload_sha256);
  });

  it("refuses a branch name in place of a resolved commit", async () => {
    await expect(build({ sourceRevision: "feat-video-primitives" })).rejects.toThrow(
      /resolved commit SHA/,
    );
  });

  it("fails the build when the embedder returns the wrong count", async () => {
    const short: Embedder = async () => [[0.1, 0.2, 0.3, 0.4]];
    await expect(build({ embed: short })).rejects.toThrow(/Expected 2 vectors/);
  });

  it("fails the build when the embedder throws, publishing nothing", async () => {
    const failing: Embedder = async () => {
      throw new Error("provider unavailable");
    };
    await expect(build({ embed: failing })).rejects.toThrow(/provider unavailable/);
  });

  it("fails the build on an unexpected dimension", async () => {
    await expect(build({ expectedDimension: 1536 })).rejects.toThrow(/dimension 4, expected 1536/);
  });

  it("fails the build on a non-finite value", async () => {
    const bad: Embedder = async (texts) => texts.map(() => [Number.NaN, 1, 1, 1]);
    await expect(build({ embed: bad })).rejects.toThrow(/non-finite/);
  });

  it("fails the build on a zero vector", async () => {
    const zero: Embedder = async (texts) => texts.map(() => [0, 0, 0, 0]);
    await expect(build({ embed: zero })).rejects.toThrow(/zero vector/);
  });

  it("fails the build on inconsistent vector widths", async () => {
    const ragged: Embedder = async (texts) =>
      texts.map((_, i) => (i === 0 ? [1, 1, 1, 1] : [1, 1]));
    await expect(build({ embed: ragged })).rejects.toThrow(/expected 4/);
  });
});

describe("local vector revision", () => {
  it("is stable across filesystem traversal order", () => {
    const first = new Map([
      ["whip-pan", "Fast transition"],
      ["count-up", "Animated number"],
    ]);
    const reversed = new Map([...first].reverse());

    expect(localVectorRevision("model", "revision", 384, first)).toBe(
      localVectorRevision("model", "revision", 384, reversed),
    );
  });

  it("uses locale-independent code-unit ordering", () => {
    const corpus = new Map([
      ["ä-item", "Third"],
      ["a-item", "First"],
      ["z-item", "Second"],
    ]);
    const expectedRows = [
      ["a-item", "First"],
      ["z-item", "Second"],
      ["ä-item", "Third"],
    ];

    expect(localVectorRevision("model", "revision", 384, corpus)).toBe(
      sha256Hex(
        JSON.stringify({
          model: "model",
          modelRevision: "revision",
          dimensions: 384,
          batchSize: LOCAL_VECTOR_BATCH_SIZE,
          rows: expectedRows,
        }),
      ),
    );
  });

  it("changes when searchable text changes under the same name", () => {
    const before = new Map([["whip-pan", "Fast transition"]]);
    const after = new Map([["whip-pan", "Fast energetic transition"]]);

    expect(localVectorRevision("model", "revision", 384, before)).not.toBe(
      localVectorRevision("model", "revision", 384, after),
    );
  });

  it("changes when the embedding contract changes", () => {
    const corpus = new Map([["whip-pan", "Fast transition"]]);

    expect(localVectorRevision("model-a", "revision", 384, corpus)).not.toBe(
      localVectorRevision("model-b", "revision", 384, corpus),
    );
    expect(localVectorRevision("model-a", "revision", 384, corpus)).not.toBe(
      localVectorRevision("model-a", "revision", 768, corpus),
    );
    expect(localVectorRevision("model-a", "revision-a", 384, corpus)).not.toBe(
      localVectorRevision("model-a", "revision-b", 384, corpus),
    );
  });
});

describe("verify contract", () => {
  it("accepts a freshly built artifact", async () => {
    const built = await build();
    expect(() => verifyArtifact(built)).not.toThrow();
  });

  it("rejects a mutated description", async () => {
    const built = await build();
    const mutated = Buffer.from(
      built.catalogBytes.toString("utf-8").replace("Motion.", "Tampered."),
    );
    expect(() => verifyArtifact({ ...built, catalogBytes: mutated })).toThrow(
      /does not match the manifest/,
    );
  });

  it("rejects a mutated vector", async () => {
    const built = await build();
    const mutated = Buffer.from(built.vectorsBytes.toString("utf-8").replace("0.5", "0.6"));
    expect(() => verifyArtifact({ ...built, vectorsBytes: mutated })).toThrow(
      /does not match the manifest/,
    );
  });

  it("rejects a manifest whose count disagrees with the payload", async () => {
    const built = await build();
    expect(() =>
      verifyArtifact({ ...built, manifest: { ...built.manifest, move_count: 99 } }),
    ).toThrow(/declares 99/);
  });

  it("rejects an unknown schema version", async () => {
    const built = await build();
    expect(() =>
      verifyArtifact({ ...built, manifest: { ...built.manifest, schema_version: 99 } }),
    ).toThrow(/schema version/);
  });
});

describe("consumer parity", () => {
  it("computes the digest the Python consumer computes", () => {
    // Pinned from the Python consumer for the same inputs. Both sides hash file
    // bytes as sha256(sha256(catalog) || sha256(vectors)), so a change to either
    // implementation fails here rather than producing an artifact the consumer
    // silently rejects at load time.
    const digest = payloadDigest(
      Buffer.from("catalog-bytes", "utf-8"),
      Buffer.from("vector-bytes", "utf-8"),
    );
    expect(digest).toBe("291c30dddc35c705a681081d9c2e2a96314bcccf0d024b77a3692e412adbf103");
  });

  it("reproduces the evaluated shelf when one is available", () => {
    // Opt-in: needs the pinned shelf. Guards the ported contract against drift.
    const shelfPath = process.env.EVAL_SHELF_PATH;
    if (!shelfPath) return;
    const entries = parseShelf(readFileSync(join(shelfPath), "utf-8"));
    expect(entries.size).toBe(424);
  });
});

describe("movesMissingFromRegistry", () => {
  it("names the shelf moves no registry item can serve", () => {
    // The failure this guards produced no error at all: the artifact shipped,
    // ranked these moves highest, and the client then had nothing to show.
    expect(movesMissingFromRegistry(["count-up", "number-wheel"], ["count-up"])).toEqual([
      "number-wheel",
    ]);
  });

  it("is empty when the registry covers the shelf", () => {
    expect(movesMissingFromRegistry(["count-up"], ["count-up", "badge-pop"])).toEqual([]);
  });

  it("reports every move when the registry is empty", () => {
    expect(movesMissingFromRegistry(["a", "b"], [])).toEqual(["a", "b"]);
  });
});
