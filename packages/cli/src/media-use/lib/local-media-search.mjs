import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_DIRECTORY = join(homedir(), ".hyperframes", "catalog");

function directory() {
  return process.env.HYPERFRAMES_CATALOG_ARTIFACT_DIR || DEFAULT_DIRECTORY;
}

export async function fetchMediaVectors(registryBaseUrl, options = {}) {
  const target = options.directory || directory();
  const base = registryBaseUrl.replace(/\/+$/, "");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const fetched = [];
  for (const file of ["media-vectors.json", "media-vectors.bin"]) {
    const response = await fetch(`${base}/catalog-artifact/${file}`);
    if (!response.ok) return false;
    fetched.push([file, Buffer.from(await response.arrayBuffer())]);
  }
  for (const [file, bytes] of fetched) writeFileSync(join(target, file), bytes, { mode: 0o600 });
  return true;
}

export function mediaVectorRows(target = directory()) {
  const metadataPath = join(target, "media-vectors.json");
  if (!existsSync(metadataPath)) return [];
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  return Array.isArray(metadata.rows) ? metadata.rows : [];
}

export { rankMediaRowsWithVectors } from "./media-search.mjs";
