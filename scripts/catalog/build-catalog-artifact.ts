/**
 * Publish the video-primitive catalog artifact.
 *
 * Usage:
 *   tsx scripts/catalog/build-catalog-artifact.ts --shelf <path> --revision <sha> [--out <dir>]
 *
 * Requires OPENAI_API_KEY. Embedding 424 descriptions is a real, paid call, so
 * this is invoked deliberately rather than on every commit. The artifact is
 * verified after writing: a build that cannot be read back is a failed build.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildArtifact,
  manifestBytes,
  movesMissingFromRegistry,
  parseShelf,
  verifyArtifact,
  type Embedder,
} from "./catalog-artifact.js";

// Measured on the 405-brief gold set, not chosen from a leaderboard:
// 3-large scores 60.5% recall@20 against 54.1% for 3-small, a 6.4 point gain.
// Embedding the whole catalog costs a couple of cents, and per-query cost is
// negligible, so the larger model is the better default by a wide margin.
const EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_DIMENSION = 3072;
const BATCH_SIZE = 100;
const DEFAULT_REGISTRY_INDEX = "registry/registry.json";
const DEFAULT_OUT = "registry/catalog-artifact";

/**
 * Read the names the registry can actually serve.
 *
 * Absent index means the caller opted out of the check rather than passed it,
 * so that case is reported by the caller instead of being treated as a pass.
 */
function registryNames(indexPath: string): string[] | undefined {
  try {
    const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as {
      items?: { name?: string }[];
    };
    if (!Array.isArray(parsed.items)) return undefined;
    return parsed.items
      .map((item) => item.name)
      .filter((name): name is string => typeof name === "string");
  } catch {
    return undefined;
  }
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Batched so a 424-move shelf does not depend on one oversized request. */
// request assembly plus the error cases a remote embedder can return
// fallow-ignore-next-line complexity
const openAiEmbedder: Embedder = async (texts) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += BATCH_SIZE) {
    const batch = texts.slice(start, start + BATCH_SIZE);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { data: { index: number; embedding: number[] }[] };
    // Order is documented as preserved, but index is returned explicitly, so
    // sort by it rather than trusting position.
    const ordered = [...body.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== batch.length) {
      throw new Error(`Expected ${batch.length} embeddings, received ${ordered.length}`);
    }
    vectors.push(...ordered.map((item) => item.embedding));
  }
  return vectors;
};

// a script entry point
// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const shelfPath = arg("shelf");
  const revision = arg("revision");
  const out = arg("out") ?? DEFAULT_OUT;
  if (!shelfPath || !revision) {
    throw new Error("Both --shelf and --revision are required");
  }

  const shelfText = readFileSync(shelfPath, "utf-8");
  // Only publish moves the registry can serve. The shelf doubles as a design
  // document, so it lists moves that were specified and never built.
  const installableNames = registryNames(arg("registry-index") ?? DEFAULT_REGISTRY_INDEX);
  const built = await buildArtifact({
    shelfText,
    ...(installableNames ? { installableNames } : {}),
    sourceRevision: revision,
    embeddingModel: EMBEDDING_MODEL,
    embed: openAiEmbedder,
    expectedDimension: EMBEDDING_DIMENSION,
  });

  // Verify before writing. Publishing something we cannot read back would put
  // the burden of discovering it on the consumer at request time.
  verifyArtifact(built);

  // What is left to report is the gap, not a defect in the artifact: buildArtifact
  // already dropped these, so the published catalog never contains a move the
  // registry cannot serve. Reported, not fatal, because the shelf legitimately
  // leads the registry while moves land.
  if (installableNames === undefined) {
    console.warn("warning   registry index unreadable; published every shelf move unchecked");
  } else {
    const dropped = movesMissingFromRegistry([...parseShelf(shelfText).keys()], installableNames);
    if (dropped.length > 0) {
      console.warn(
        `warning   ${dropped.length} shelf moves dropped, no registry item: ${dropped.slice(0, 5).join(", ")}${dropped.length > 5 ? ", ..." : ""}`,
      );
    }
  }

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "catalog.json"), built.catalogBytes);
  writeFileSync(join(out, "vectors.json"), built.vectorsBytes);
  writeFileSync(join(out, "manifest.json"), manifestBytes(built.manifest));

  console.log(`moves     ${built.manifest.move_count}`);
  console.log(`model     ${built.manifest.embedding_model}`);
  console.log(`revision  ${built.manifest.source_revision}`);
  console.log(`version   ${built.manifest.payload_sha256}`);
  console.log(`written   ${out}`);
}

await main();
