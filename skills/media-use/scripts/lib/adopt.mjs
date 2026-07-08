import { readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { readManifest, appendRecord, nextId } from "./manifest.mjs";
import { regenerateIndex } from "./index-gen.mjs";
import { probe } from "./probe.mjs";
import { matchTokens } from "./match.mjs";

const AUDIO_EXT = new Set([".mp3", ".wav", ".ogg", ".m4a", ".aac"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov"]);

function inferType(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (AUDIO_EXT.has(ext)) {
    const lower = filePath.toLowerCase();
    if (lower.includes("/bgm/") || lower.includes("/music/") || lower.startsWith("bgm/"))
      return "bgm";
    if (lower.includes("/sfx/") || lower.includes("/sound") || lower.startsWith("sfx/"))
      return "sfx";
    if (lower.includes("/voice/") || lower.includes("/narrat") || lower.startsWith("voice/"))
      return "voice";
    return "bgm";
  }
  if (IMAGE_EXT.has(ext)) {
    if (ext === ".svg" || ext === ".ico") return "icon";
    return "image";
  }
  if (VIDEO_EXT.has(ext)) return "video";
  return null;
}

function walkDir(dir, base = "") {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...walkDir(join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

export function scanExistingAssets(projectDir) {
  const assetsDir = join(projectDir, "assets");
  if (!existsSync(assetsDir)) return [];

  const files = walkDir(assetsDir);
  const found = [];
  for (const rel of files) {
    const type = inferType(rel);
    if (!type) continue;
    const fullPath = join(assetsDir, rel);
    const stat = statSync(fullPath);
    if (stat.size === 0) {
      // A 0-byte asset would register clean but fail at render — skip it loudly
      // rather than adopt a broken file.
      console.error(`media-use: skipping 0-byte asset assets/${rel}`);
      continue;
    }
    const meta = probe(fullPath);
    found.push({
      relativePath: `assets/${rel}`,
      type,
      size: stat.size,
      name: basename(rel, extname(rel)),
      ...meta,
    });
  }
  return found;
}

export function adoptExistingAssets(projectDir) {
  const existing = scanExistingAssets(projectDir);
  if (existing.length === 0) return [];

  const manifest = readManifest(projectDir);
  const knownPaths = new Set(manifest.map((r) => r.path));

  const adopted = [];
  for (const asset of existing) {
    if (knownPaths.has(asset.relativePath)) continue;

    const id = nextId(projectDir, asset.type);
    const record = {
      id,
      type: asset.type,
      path: asset.relativePath,
      source: "existing",
      description: asset.name.replace(/[-_]/g, " "),
      ...(asset.duration != null && { duration: asset.duration }),
      ...(asset.width != null && { width: asset.width }),
      ...(asset.height != null && { height: asset.height }),
      provenance: { provider: "local", adopted: true },
    };
    appendRecord(projectDir, record);
    adopted.push(record);
  }

  if (adopted.length > 0) regenerateIndex(projectDir);
  return adopted;
}

// Adopt a pre-existing assets/ file only when it shares a meaningful word with
// the intent. The old test — `name.includes(intent) || intent.includes(name)` —
// silently returned the WRONG file: "whoosh" grabbed a stray who.mp3, and a
// one-letter filename matched every intent. A false negative just falls through
// to a catalog search (safe); a false positive ships the wrong asset. So bias to
// precision: require a shared token, don't guess from substrings.
export function findExistingAsset(projectDir, intent, type) {
  const assetsDir = join(projectDir, "assets");
  if (!existsSync(assetsDir)) return null;
  const intentTokens = matchTokens(intent);
  if (intentTokens.size === 0) return null;
  for (const rel of walkDir(assetsDir)) {
    const t = inferType(rel);
    if (!t || (type && t !== type)) continue;
    const stem = basename(rel, extname(rel));
    for (const tok of matchTokens(stem)) {
      if (intentTokens.has(tok)) {
        return { relativePath: `assets/${rel}`, type: t, name: stem };
      }
    }
  }
  return null;
}
