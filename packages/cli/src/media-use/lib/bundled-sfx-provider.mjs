import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { rankMediaRows } from "./media-search.mjs";

const LIB_DIR =
  process.env.HYPERFRAMES_MEDIA_USE_SFX_DIR ||
  [
    join(import.meta.dirname, "..", "..", "audio", "assets", "sfx"),
    join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "skills",
      "media-use",
      "audio",
      "assets",
      "sfx",
    ),
  ].find((candidate) => existsSync(candidate)) ||
  join(import.meta.dirname, "..", "..", "audio", "assets", "sfx");

export const BUNDLED_SFX_RECOVERY_COMMAND = "npx hyperframes skills update media-use";

export class BundledSfxAssetsError extends Error {
  constructor(health) {
    super(
      `bundled SFX assets are missing or incomplete (${health.detail}). For the user: \`${health.fix}\` repairs the installed media-use skill.`,
    );
    this.name = "BundledSfxAssetsError";
    this.code = health.code;
    this.fix = health.fix;
  }
}

function unhealthy(detail) {
  return {
    ok: false,
    code: "bundled_sfx_assets_missing",
    detail,
    fix: BUNDLED_SFX_RECOVERY_COMMAND,
  };
}

export function inspectBundledSfxAssets(libraryDir = LIB_DIR) {
  const manifestPath = join(libraryDir, "manifest.json");
  if (!existsSync(manifestPath)) return unhealthy(`manifest not found: ${manifestPath}`);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return unhealthy(`manifest is not valid JSON: ${manifestPath}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return unhealthy(`manifest must contain an object: ${manifestPath}`);
  }

  const entries = Object.entries(manifest);
  if (entries.length === 0) return unhealthy(`manifest contains no SFX entries: ${manifestPath}`);
  for (const [key, entry] of entries) {
    if (!entry?.file || typeof entry.file !== "string") {
      return unhealthy(`manifest entry "${key}" has no file`);
    }
    const assetPath = join(libraryDir, entry.file);
    if (!existsSync(assetPath)) return unhealthy(`asset not found: ${assetPath}`);
  }

  return {
    ok: true,
    count: entries.length,
    detail: `${entries.length} bundled SFX asset${entries.length === 1 ? "" : "s"} available`,
    fix: "",
  };
}

export function extensionForBundledSfxFile(filename) {
  return extname(filename) || ".mp3";
}

const INDEX_FILE_PREFIX = "skills/media-use/audio/assets/sfx/";
const AUDIO_FILE_NAME =
  /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(?:mp3|wav|ogg|m4a|aac|flac)$/i;

/**
 * Map a media index row's `file` to an audio file inside the bundled SFX folder, or null.
 * The only accepted form is `skills/media-use/audio/assets/sfx/<name>` with a plain audio
 * file name; the result must still be a regular file inside the folder after realpath.
 */
export function bundledSfxAssetPath(file, libraryDir = LIB_DIR) {
  if (typeof file !== "string" || !file.startsWith(INDEX_FILE_PREFIX)) return null;
  const name = file.slice(INDEX_FILE_PREFIX.length);
  if (!AUDIO_FILE_NAME.test(name)) return null;
  try {
    const root = realpathSync(libraryDir);
    const asset = realpathSync(join(root, name));
    const inside = relative(root, asset);
    if (!inside || inside.startsWith("..") || isAbsolute(inside)) return null;
    if (!AUDIO_FILE_NAME.test(inside) || !statSync(asset).isFile()) return null;
    return asset;
  } catch {
    return null;
  }
}

export const bundledSfxProvider = {
  async search(intent, ctx = {}) {
    const libraryDir = ctx.libraryDir || LIB_DIR;
    const health = inspectBundledSfxAssets(libraryDir);
    if (!health.ok) throw new BundledSfxAssetsError(health);
    const manifest = JSON.parse(readFileSync(join(libraryDir, "manifest.json"), "utf8"));

    const rows = Object.entries(manifest).map(([key, entry]) => ({
      id: key,
      kind: "sfx",
      title: key,
      description: entry?.description || key,
      tags: ["sfx"],
      file: entry?.file || "",
      duration: entry?.duration,
    }));
    const bestRow = rankMediaRows(intent, rows)[0];
    const best =
      bestRow && manifest[bestRow.id]?.file
        ? { key: bestRow.id, entry: manifest[bestRow.id] }
        : null;
    if (!best) return null;

    const localPath = join(libraryDir, best.entry.file);
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
