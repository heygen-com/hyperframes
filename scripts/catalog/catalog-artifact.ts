/**
 * Build the published video-primitive catalog artifact.
 *
 * HyperFrames owns the shelf, so HyperFrames owns this job. Descriptions and
 * their vectors publish together as one version, because a consumer that loads
 * a new description against an old vector produces a ranking that is wrong in a
 * way nothing alarms on.
 *
 * The retrieval-text contract is inherited from the evaluation and must not
 * drift: an entry starts at a `### ` heading, only `group`, `what`, `use_when`
 * and `avoid_when` form the body, the move name is deliberately excluded, and
 * names sort before embedding. Excluding the name keeps a move from winning on
 * its own label, which is what lexical ranking already does.
 */

import { createHash } from "node:crypto";

export const RETRIEVAL_FIELDS = ["group", "what", "use_when", "avoid_when"] as const;
export const MANIFEST_SCHEMA_VERSION = 1;
/** Padding changes quantized embeddings, so batch size is part of vector identity. */
export const LOCAL_VECTOR_BATCH_SIZE = 16;

export interface CatalogManifest {
  schema_version: number;
  source_revision: string;
  shelf_sha256: string;
  embedding_model: string;
  move_count: number;
  payload_sha256: string;
}

export interface BuiltArtifact {
  manifest: CatalogManifest;
  catalogBytes: Buffer;
  vectorsBytes: Buffer;
}

/** Embed texts in the order given. Injected so tests never make a paid call. */
export type Embedder = (texts: string[]) => Promise<number[][]>;

// tolerant parser for a hand-edited file
// fallow-ignore-next-line complexity
export function parseShelf(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  const blocks = text.split(/^### /m).slice(1);
  for (const block of blocks) {
    const lines = block.split("\n");
    const name = (lines[0] ?? "").trim();
    if (!name) continue;
    if (entries.has(name)) throw new Error(`Duplicate move name in shelf: ${name}`);
    const body = lines
      .slice(1)
      .filter((line) => (RETRIEVAL_FIELDS as readonly string[]).includes(line.split(":")[0] ?? ""));
    entries.set(name, body.join("\n"));
  }
  if (entries.size === 0) throw new Error("Shelf contains no entries");
  return entries;
}

/** Embedding order. Vector N corresponds to element N of this list. */
/**
 * One registry item's retrieval text.
 *
 * Title, description and tags only. The name is deliberately excluded: it is
 * what the query is trying to find, and folding it into the text being matched
 * rewards items whose name happens to echo the query wording rather than items
 * that do what was asked.
 */
export function itemRetrievalText(item: {
  title?: string;
  description?: string;
  tags?: readonly string[];
}): string {
  const parts = [item.title ?? "", item.description ?? "", (item.tags ?? []).join(" ")];
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Read every installable item into the same shape parseShelf produces.
 *
 * Items with no usable text are skipped rather than embedded empty: an
 * all-zero-signal entry still occupies a slot in every ranking.
 */
// walks the registry and skips several kinds of item, each for a different reason
// fallow-ignore-next-line complexity
export function catalogFromRegistry(
  registryDir: string,
  read: (path: string) => string,
  listDirs: (path: string) => string[],
): Map<string, string> {
  const catalog = new Map<string, string>();
  for (const type of ["blocks", "components"]) {
    let names: string[];
    try {
      names = listDirs(`${registryDir}/${type}`);
    } catch {
      continue;
    }
    for (const name of names.sort()) {
      let item: { title?: string; description?: string; tags?: string[] };
      try {
        item = JSON.parse(read(`${registryDir}/${type}/${name}/registry-item.json`)) as typeof item;
      } catch {
        continue;
      }
      const text = itemRetrievalText(item);
      if (text) catalog.set(name, text);
    }
  }
  return catalog;
}

export function sortedNames(entries: Map<string, string>): string[] {
  return [...entries.keys()].sort();
}

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Identity of the searchable corpus and the model contract that embedded it.
 *
 * Sorted entries make filesystem traversal order irrelevant. The text stays
 * in the digest, so changing a title, description, or tag changes the revision
 * even when every catalog name remains the same.
 */
export function localVectorRevision(
  model: string,
  modelRevision: string,
  dimensions: number,
  entries: ReadonlyMap<string, string>,
): string {
  const rows = [...entries.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return sha256Hex(
    JSON.stringify({
      model,
      modelRevision,
      dimensions,
      batchSize: LOCAL_VECTOR_BATCH_SIZE,
      rows,
    }),
  );
}

/**
 * Digest the two published files as bytes.
 *
 * Deliberately over bytes rather than re-serialized structures. The consumer is
 * Python and this producer is TypeScript, and the two disagree on JSON number
 * formatting: a whole-valued float serializes as `1.0` in one and `1` in the
 * other. Hashing bytes removes the canonicalization question rather than
 * documenting it. The consumer computes this identically.
 */
export function payloadDigest(catalogBytes: Buffer, vectorsBytes: Buffer): string {
  const digest = createHash("sha256");
  digest.update(createHash("sha256").update(catalogBytes).digest());
  digest.update(createHash("sha256").update(vectorsBytes).digest());
  return digest.digest("hex");
}

/** Stable serialization so an unchanged shelf rebuilds byte-identically. */
function serialize(record: Record<string, unknown>): Buffer {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return Buffer.from(`${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
}

// assembles one artifact from several optional inputs; each branch is an input that may be absent
// fallow-ignore-next-line complexity
export async function buildArtifact(options: {
  shelfText: string;
  sourceRevision: string;
  embeddingModel: string;
  embed: Embedder;
  expectedDimension?: number;
  /**
   * Names the registry can serve. When given, shelf moves absent from it are
   * left out of the artifact: a move that ranks and cannot be installed is
   * worse than one that never appears, because it occupies a top slot.
   */
  installableNames?: readonly string[];
}): Promise<BuiltArtifact> {
  const { shelfText, sourceRevision, embeddingModel, embed, expectedDimension } = options;
  if (!/^[0-9a-f]{40}$/i.test(sourceRevision)) {
    throw new Error(`source_revision must be a resolved commit SHA, got ${sourceRevision}`);
  }

  const entries = parseShelf(shelfText);
  if (options.installableNames) {
    for (const name of movesMissingFromRegistry([...entries.keys()], options.installableNames)) {
      entries.delete(name);
    }
  }
  const names = sortedNames(entries);
  const vectors = await embed(names.map((name) => entries.get(name) as string));

  // Every validation runs before anything is written. A build that emits
  // descriptions and then fails to embed would publish exactly the half-artifact
  // the publish-together rule exists to prevent.
  if (vectors.length !== names.length) {
    throw new Error(`Expected ${names.length} vectors, embedder returned ${vectors.length}`);
  }
  const width = vectors[0]?.length ?? 0;
  if (width === 0) throw new Error("Embedder returned empty vectors");
  if (expectedDimension !== undefined && width !== expectedDimension) {
    throw new Error(`Vectors have dimension ${width}, expected ${expectedDimension}`);
  }
  vectors.forEach((vector, index) => {
    if (vector.length !== width) {
      throw new Error(
        `Vector for ${names[index]} has dimension ${vector.length}, expected ${width}`,
      );
    }
    if (!vector.every((value) => Number.isFinite(value))) {
      throw new Error(`Vector for ${names[index]} contains a non-finite value`);
    }
    if (!vector.some((value) => value !== 0)) {
      throw new Error(`Vector for ${names[index]} is a zero vector`);
    }
  });

  const catalog: Record<string, string> = {};
  const vectorMap: Record<string, number[]> = {};
  names.forEach((name, index) => {
    catalog[name] = entries.get(name) as string;
    vectorMap[name] = vectors[index] as number[];
  });

  const catalogBytes = serialize(catalog);
  const vectorsBytes = serialize(vectorMap);

  return {
    catalogBytes,
    vectorsBytes,
    manifest: {
      schema_version: MANIFEST_SCHEMA_VERSION,
      source_revision: sourceRevision,
      shelf_sha256: sha256Hex(shelfText),
      embedding_model: embeddingModel,
      move_count: names.length,
      payload_sha256: payloadDigest(catalogBytes, vectorsBytes),
    },
  };
}

/**
 * Shelf moves with no matching registry item.
 *
 * Ranking is published separately from the items themselves, so the two drift.
 * A move only present in the shelf ranks well and then cannot be shown or
 * installed, which reads to the user as a bad search rather than a bad build.
 */
export function movesMissingFromRegistry(
  shelfNames: readonly string[],
  registryNames: readonly string[],
): string[] {
  const known = new Set(registryNames);
  return shelfNames.filter((name) => !known.has(name));
}

export function manifestBytes(manifest: CatalogManifest): Buffer {
  return serialize(manifest as unknown as Record<string, unknown>);
}

/** Recompute the published digest and compare it to what the manifest claims. */
// one check per way an artifact can be wrong; collapsing them would lose which one failed
// fallow-ignore-next-line complexity
export function verifyArtifact(input: {
  manifest: CatalogManifest;
  catalogBytes: Buffer;
  vectorsBytes: Buffer;
}): void {
  const { manifest, catalogBytes, vectorsBytes } = input;
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Manifest schema version ${manifest.schema_version} is not ${MANIFEST_SCHEMA_VERSION}`,
    );
  }
  const catalog = JSON.parse(catalogBytes.toString("utf-8")) as Record<string, string>;
  const vectors = JSON.parse(vectorsBytes.toString("utf-8")) as Record<string, number[]>;

  const names = Object.keys(catalog);
  if (names.length !== manifest.move_count) {
    throw new Error(
      `Artifact holds ${names.length} moves but the manifest declares ${manifest.move_count}`,
    );
  }
  const missing = names.filter((name) => !(name in vectors));
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} moves have a description but no vector, first is ${missing[0]}`,
    );
  }

  const actual = payloadDigest(catalogBytes, vectorsBytes);
  if (actual !== manifest.payload_sha256) {
    throw new Error(
      `Payload digest ${actual} does not match the manifest's ${manifest.payload_sha256}`,
    );
  }
}
