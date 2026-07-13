import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const LIB_DIR = join(import.meta.dirname, "..", "..", "audio", "assets", "sfx");

const normalize = (value) =>
  String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function extensionForBundledSfxFile(filename) {
  return extname(filename) || ".mp3";
}

function score(intent, key, entry) {
  const query = normalize(intent);
  const name = normalize(key);
  if (query === name) return 100;
  if (query.includes(name) || name.includes(query)) return 50;
  const haystack = new Set(normalize(`${key} ${entry.description || ""}`).split(/\s+/));
  return query.split(/\s+/).filter((token) => token && haystack.has(token)).length;
}

export const bundledSfxProvider = {
  async search(intent) {
    const manifestPath = join(LIB_DIR, "manifest.json");
    if (!existsSync(manifestPath)) return null;

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      return null;
    }

    const ranked = Object.entries(manifest)
      .map(([key, entry]) => ({ key, entry, score: score(intent, key, entry) }))
      .filter(({ entry, score }) => entry?.file && score > 0)
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    const best = ranked[0];
    if (!best) return null;

    const localPath = join(LIB_DIR, best.entry.file);
    if (!existsSync(localPath)) return null;
    return {
      localPath,
      ext: extensionForBundledSfxFile(best.entry.file),
      source: "bundled",
      metadata: {
        description: best.entry.description || best.key,
        duration: best.entry.duration ?? null,
        provider: "bundled.sfx",
        provenance: { library_key: best.key },
      },
    };
  },
};
