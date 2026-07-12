import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { readManifest, appendRecord, normalizePrompt } from "./manifest.mjs";

const SCHEMA_PREFIX = "mu-v1-";
const KEY_HEX_CHARS = 16;
const COMPLETE_SENTINEL = ".hf-complete";

export function globalMediaDir() {
  return join(homedir(), ".media");
}

export function contentHash(filePath) {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function cacheEntryDir(rootDir, sha) {
  return join(rootDir, SCHEMA_PREFIX + sha.slice(0, KEY_HEX_CHARS));
}

function isComplete(entryDir) {
  return existsSync(join(entryDir, COMPLETE_SENTINEL));
}

function markComplete(entryDir) {
  writeFileSync(join(entryDir, COMPLETE_SENTINEL), "", "utf8");
}

// The manifest helpers append their own ".media" to the dir they get, so the
// global manifest must be addressed by HOME, not by globalMediaDir() — passing
// the latter nested it at ~/.media/.media/manifest.jsonl, invisible to the
// Studio /api/assets/global route (which reads the documented flat path).
export function readGlobalManifest() {
  return readManifest(homedir());
}

// Resolve a content-sha (full or unambiguous prefix) to a reusable global-cache
// record, for `resolve --reuse <sha>`. Returns null on no match, or
// { ambiguous: true, count } when a prefix matches multiple distinct entries.
// Completeness (the .hf-complete sentinel) is left to importFromCache so the
// caller can surface an "incomplete cache entry" error distinctly from a miss.
export function findGlobalBySha(shaPrefix) {
  const p = String(shaPrefix || "")
    .toLowerCase()
    .trim();
  if (!p) return null;
  const matches = readGlobalManifest().filter(
    (r) => r.reusable && typeof r.sha === "string" && r.sha.startsWith(p),
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const exact = matches.find((r) => r.sha === p);
    if (exact) return exact;
    return { ambiguous: true, count: matches.length };
  }
  return matches[0];
}

function validateCacheHit(match) {
  if (!match?.sha) return null;
  return isComplete(cacheEntryDir(globalMediaDir(), match.sha)) ? match : null;
}

export function cacheGet(prompt, type) {
  const key = normalizePrompt(prompt);
  if (!key) return null;
  return validateCacheHit(
    readGlobalManifest().find(
      (r) =>
        r.reusable &&
        normalizePrompt(r.provenance?.prompt) === key &&
        (type == null || r.type === type),
    ),
  );
}

export function cacheGetByEntity(entity) {
  const lower = entity.toLowerCase();
  return validateCacheHit(
    readGlobalManifest().find((r) => r.reusable && r.entity && r.entity.toLowerCase() === lower),
  );
}

export function cachePut(filePath, record) {
  const sha = contentHash(filePath);
  // Idempotent: same content already promoted -> don't duplicate the global
  // record. ponytail: skips usage_count bump; add it when the metric is needed.
  const existing = readGlobalManifest().find((r) => r.sha === sha);
  if (existing) return { sha, cached_path: existing.cached_path, deduped: true };

  const dir = globalMediaDir();
  const entryDir = cacheEntryDir(dir, sha);
  mkdirSync(entryDir, { recursive: true });

  const dest = join(entryDir, basename(filePath));
  copyFileSync(filePath, dest);
  markComplete(entryDir);

  const globalRecord = {
    ...record,
    sha,
    reusable: true,
    cached_path: dest,
  };
  appendRecord(homedir(), globalRecord);
  return { sha, cached_path: dest };
}

export function importFromCache(cacheRecord, projectDir, localId, localPath) {
  const sha = cacheRecord.sha;
  const entryDir = cacheEntryDir(globalMediaDir(), sha);
  if (!isComplete(entryDir)) return null;

  const cachedFile = cacheRecord.cached_path;
  if (!cachedFile || !existsSync(cachedFile)) return null;

  mkdirSync(join(projectDir, ".media"), { recursive: true });
  const fullDest = join(projectDir, localPath);
  mkdirSync(join(fullDest, ".."), { recursive: true });
  copyFileSync(cachedFile, fullDest);

  const projectRecord = {
    ...cacheRecord,
    id: localId,
    path: localPath,
    provenance: {
      ...cacheRecord.provenance,
      imported_from: sha,
    },
  };
  delete projectRecord.sha;
  delete projectRecord.reusable;
  delete projectRecord.cached_path;

  return projectRecord;
}

export function promote(projectDir, id) {
  const records = readManifest(projectDir);
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error(`asset not found in project manifest: ${id}`);

  const filePath = join(projectDir, record.path);
  if (!existsSync(filePath)) throw new Error(`asset file not found: ${filePath}`);

  return cachePut(filePath, record);
}
