import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MEDIA_VECTOR_DIMENSIONS = 384;

// The index ships inside the CLI (dist/catalog-artifact, or registry/catalog-artifact in a
// source checkout), so it always describes the SFX files of this same release.
const BUNDLED_MEDIA_VECTORS = [
  join(import.meta.dirname, "..", "..", "..", "..", "catalog-artifact", "media-vectors.json"),
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "..",
    "registry",
    "catalog-artifact",
    "media-vectors.json",
  ),
].find((candidate) => existsSync(candidate));

function isMediaVectorRow(row) {
  return (
    !!row &&
    typeof row === "object" &&
    typeof row.id === "string" &&
    typeof row.kind === "string" &&
    typeof row.title === "string" &&
    typeof row.description === "string" &&
    Array.isArray(row.tags) &&
    row.tags.every((tag) => typeof tag === "string") &&
    typeof row.file === "string" &&
    (row.duration === undefined ||
      (typeof row.duration === "number" && Number.isFinite(row.duration) && row.duration >= 0))
  );
}

function indexProblem(metadata) {
  if (!metadata || typeof metadata !== "object") return "not an object";
  if (metadata.dimensions !== MEDIA_VECTOR_DIMENSIONS) {
    return `expected ${MEDIA_VECTOR_DIMENSIONS} dimensions, got ${metadata.dimensions}`;
  }
  const { names, rows } = metadata;
  if (!Array.isArray(names) || !Array.isArray(rows) || names.length !== rows.length) {
    return "names and rows do not line up";
  }
  if (rows.some((row, index) => !isMediaVectorRow(row) || row.id !== names[index])) {
    return "a row is malformed or out of order";
  }
  const revision = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  if (metadata.metadataRevision !== revision) return "rows do not match metadataRevision";
  return null;
}

export function mediaVectorRows(metadataPath = BUNDLED_MEDIA_VECTORS) {
  if (!metadataPath || !existsSync(metadataPath)) return [];
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const problem = indexProblem(metadata);
  if (problem) throw new Error(`media index ${metadataPath} is invalid: ${problem}`);
  return metadata.rows;
}

export { rankMediaRowsWithVectors } from "./media-search.mjs";
