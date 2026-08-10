/**
 * Rank the catalog by meaning, on the user's machine, for free.
 *
 * Sits between word matching and the hosted endpoint. Word matching cannot
 * connect "make the pace feel faster" to a whip pan because they share no
 * words; the hosted endpoint can, but needs an account and a network. This
 * closes that gap with a 33 MB model the user opted into.
 *
 * The vectors here are 384-dimension and were produced by a different model
 * than the hosted 1536-dimension set. The two are not comparable and are never
 * mixed: a query is embedded by whichever model produced the vectors it is
 * being compared against.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { cosine, loadLocalEmbedder } from "./localEmbedder.js";
import { LOCAL_MODEL_DIMENSIONS, isLocalModelReady } from "./localModel.js";

interface LocalVectorSet {
  names: string[];
  dimensions: number;
  vectors: Float32Array;
}

interface LocalVectorMetadata {
  names: string[];
  dimensions: number;
  revision?: string;
}

export interface FetchLocalVectorOptions {
  directory?: string;
  expectedRevision?: string;
}

const CATALOG_ARTIFACT_TIMEOUT_MS = 30_000;

/** Where the bundled vector set lives, overridable for development. */
function localVectorDirectory(): string {
  return (
    process.env["HYPERFRAMES_CATALOG_ARTIFACT_DIR"] ?? join(homedir(), ".hyperframes", "catalog")
  );
}

/**
 * Put the catalog vectors in the user's cache, once.
 *
 * They are fetched rather than bundled: every install would otherwise carry a
 * copy of a file only people who opt into offline ranking will ever read, and
 * the vectors have to track the registry anyway, so shipping them inside the
 * package would freeze them to the release instead.
 *
 * Returns false rather than throwing. A download that fails costs the offline
 * tier, never the command, and the caller says so.
 */
/**
 * Do a freshly fetched metadata/matrix pair describe the same index?
 *
 * `names.length * dimensions` floats, at four bytes each, is the whole
 * contract. A pair that fails it is a truncated download or a different
 * model, never something worth caching.
 */
function vectorPairAgrees(fetched: Array<[string, Buffer]>): boolean {
  const meta = fetched.find(([file]) => file === "local-vectors.json")?.[1];
  const bin = fetched.find(([file]) => file === "local-vectors.bin")?.[1];
  if (!meta || !bin) return false;
  try {
    const parsed = JSON.parse(meta.toString("utf-8")) as {
      names?: string[];
      dimensions?: number;
    };
    if (parsed.dimensions !== LOCAL_MODEL_DIMENSIONS) return false;
    return bin.byteLength === (parsed.names?.length ?? -1) * LOCAL_MODEL_DIMENSIONS * 4;
  } catch {
    return false;
  }
}

/** The registry manifest and fetched pair must describe the same generation. */
function vectorRevisionAgrees(
  fetched: Array<[string, Buffer]>,
  expectedRevision?: string,
): boolean {
  if (expectedRevision === undefined) return true;
  const meta = fetched.find(([file]) => file === "local-vectors.json")?.[1];
  if (!meta) return false;
  try {
    const parsed = JSON.parse(meta.toString("utf-8")) as { revision?: unknown };
    return parsed.revision === expectedRevision;
  } catch {
    return false;
  }
}

export async function fetchLocalVectors(
  registryBaseUrl: string,
  options: FetchLocalVectorOptions = {},
): Promise<boolean> {
  const directory = options.directory ?? localVectorDirectory();
  const base = registryBaseUrl.replace(/\/+$/, "");
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    // Downloaded in full before anything is written. The two files have to
    // agree on how many rows there are, so a fetch that fails halfway through
    // must leave the previous pair intact rather than pairing a new name list
    // with an old matrix, which loads as an error instead of as stale data.
    const fetched: Array<[string, Buffer]> = [];
    for (const file of ["local-vectors.json", "local-vectors.bin"] as const) {
      const response = await fetch(`${base}/catalog-artifact/${file}`, {
        signal: AbortSignal.timeout(CATALOG_ARTIFACT_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      fetched.push([file, Buffer.from(await response.arrayBuffer())]);
    }
    // Check the pair agrees BEFORE either file lands. Writing first and
    // discovering the mismatch at load time leaves a cache that fails every
    // subsequent search until someone deletes it by hand, and it is the only
    // point where a truncated or wrong-model response can still be refused.
    if (!vectorPairAgrees(fetched) || !vectorRevisionAgrees(fetched, options.expectedRevision)) {
      return false;
    }
    // 0o600: the cache is this user's, and the directory may be world-writable
    // when the caller overrides it.
    for (const [file, bytes] of fetched) {
      writeFileSync(join(directory, file), bytes, { mode: 0o600 });
    }
    return hasLocalVectors(directory);
  } catch {
    return false;
  }
}

export function hasLocalVectors(directory = localVectorDirectory()): boolean {
  return (
    existsSync(join(directory, "local-vectors.bin")) &&
    existsSync(join(directory, "local-vectors.json"))
  );
}

function loadLocalVectors(directory = localVectorDirectory()): LocalVectorSet {
  const meta = JSON.parse(
    readFileSync(join(directory, "local-vectors.json"), "utf-8"),
  ) as LocalVectorMetadata;
  const buffer = readFileSync(join(directory, "local-vectors.bin"));
  const vectors = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);

  const expected = meta.names.length * meta.dimensions;
  if (vectors.length !== expected) {
    throw new Error(`local vectors hold ${vectors.length} floats, expected ${expected}`);
  }
  if (meta.dimensions !== LOCAL_MODEL_DIMENSIONS) {
    // A dimension mismatch means the vectors and the model disagree, which
    // produces confident nonsense rather than an error.
    throw new Error(
      `local vectors are ${meta.dimensions}-dimension, model produces ${LOCAL_MODEL_DIMENSIONS}`,
    );
  }
  return { names: meta.names, dimensions: meta.dimensions, vectors };
}

/**
 * The names the on-device index holds, without loading the vector matrix.
 *
 * Callers compare this against the live registry to see what meaning search
 * cannot reach. Reads the metadata file only, so it costs a small JSON parse
 * rather than the whole matrix, and answers empty rather than throwing: an
 * absent or unreadable artifact covers nothing, which is a coverage answer
 * rather than a reason to fail the search that asked.
 */
export function localVectorNames(directory = localVectorDirectory()): string[] {
  if (!hasLocalVectors(directory)) return [];
  try {
    const meta = JSON.parse(readFileSync(join(directory, "local-vectors.json"), "utf-8")) as {
      names?: string[];
    };
    return meta.names ?? [];
  } catch {
    return [];
  }
}

/** Revision of the last complete pair, absent for pre-revision and unreadable caches. */
export function cachedLocalVectorRevision(directory = localVectorDirectory()): string | undefined {
  if (!hasLocalVectors(directory)) return undefined;
  try {
    const meta = JSON.parse(readFileSync(join(directory, "local-vectors.json"), "utf-8")) as {
      revision?: unknown;
    };
    return typeof meta.revision === "string" ? meta.revision : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Names ranked best first, each with the similarity that placed it there.
 * Returns null when local semantic search is not available.
 *
 * The score rides along because this ranker has no relevance threshold: every
 * query returns the whole set in some order, so a caller holding names alone
 * cannot tell a real match from the least-bad row of a query that matched
 * nothing at all.
 */
export async function localSemanticRanking(
  query: string,
  directory = localVectorDirectory(),
): Promise<Array<{ name: string; score: number }> | null> {
  if (!isLocalModelReady() || !hasLocalVectors(directory)) return null;

  const set = loadLocalVectors(directory);
  const embedder = await loadLocalEmbedder();
  const [queryVector] = await embedder.embed([query], { isQuery: true });
  if (!queryVector) return null;

  const scored = set.names.map((name, row) => {
    const start = row * set.dimensions;
    return {
      name,
      score: cosine(queryVector, Array.from(set.vectors.subarray(start, start + set.dimensions))),
    };
  });

  // Ties break on descending name, matching every other ranking in this system.
  scored.sort((a, b) => b.score - a.score || b.name.localeCompare(a.name));
  return scored;
}
