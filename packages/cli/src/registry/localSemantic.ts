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
export async function fetchLocalVectors(
  registryBaseUrl: string,
  directory = localVectorDirectory(),
): Promise<boolean> {
  const base = registryBaseUrl.replace(/\/+$/, "");
  try {
    mkdirSync(directory, { recursive: true });
    for (const file of ["local-vectors.json", "local-vectors.bin"] as const) {
      const response = await fetch(`${base}/catalog-artifact/${file}`);
      if (!response.ok) return false;
      writeFileSync(join(directory, file), Buffer.from(await response.arrayBuffer()));
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
  const meta = JSON.parse(readFileSync(join(directory, "local-vectors.json"), "utf-8")) as {
    names: string[];
    dimensions: number;
  };
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

/** Names ranked best first. Returns null when local semantic search is not available. */
export async function localSemanticRanking(
  query: string,
  directory = localVectorDirectory(),
): Promise<string[] | null> {
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
  return scored.map((entry) => entry.name);
}
