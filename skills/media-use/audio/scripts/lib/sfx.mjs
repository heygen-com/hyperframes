// sfx.mjs — sound effects for the media audio engine. Each cue is searched on
// Openverse (CC0 / CC BY only, see openverse.mjs). A cue Openverse cannot answer,
// and every cue after Openverse is unreachable or rate limited, resolves against
// the bundled 21-file library (assets/sfx/manifest.json) instead.
//
// A cue that matches nothing is skipped (recorded as an anomaly); SFX never
// blocks a render. Every cue sits at volume ~0.35, under voice + BGM.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadTo } from "./heygen.mjs";
import { OpenverseUnavailableError, searchOpenverseSfx, writeSfxCredit } from "./openverse.mjs";
import { latestRecordFor } from "../../../scripts/lib/manifest.mjs";
import { agentWritePath } from "./media-record.mjs";

export const BUNDLED_SFX_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "assets",
  "sfx",
);
const SFX_VOLUME = 0.35;
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "x";
const r3 = (x) => Number(x.toFixed(3));

// Lookups by manifest key, file basename, and slug of either, so a cue can name
// "whoosh", "whoosh.mp3", or "ui click" (→ slug match). { error } when unusable.
function loadBundledLibrary(sfxLibDir) {
  const manifestPath = join(sfxLibDir, "manifest.json");
  if (!existsSync(manifestPath)) return { error: `no bundled SFX library at ${sfxLibDir}` };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return { error: `bundled SFX manifest parse failed (${e.message})` };
  }
  const byKey = new Map();
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry?.file || !isFinite(entry.duration)) continue;
    const rec = { key, file: entry.file, duration: entry.duration };
    byKey.set(key, rec);
    byKey.set(entry.file, rec);
    byKey.set(slug(key), rec);
    byKey.set(slug(entry.file.replace(/\.\w+$/, "")), rec);
  }
  return { byKey };
}

// cues: [{ id, name }] (id = the line/frame/scene the cue fires in). Returns
// { sfx: [{ id, name, file, source, offset_s, duration_s, volume, license?, credit? }], anomalies }.
export async function resolveSfx({ cues, hyperframesDir, sfxLibDir = BUNDLED_SFX_DIR }) {
  const sfx = [];
  const anomalies = [];
  const destDir = join(hyperframesDir, "assets", "sfx");
  // Each effect's file this run: one effect named twice gets one file, and two effects never share one.
  const fileFor = new Map();
  const taken = () => new Set(fileFor.values());
  // One Openverse sound per effect name this run, so a repeated cue costs no second request.
  const openverseFor = new Map();
  let openverseDown = false;
  let library;

  // Dedupe identical (id,name) cues — the same effect named twice in one line
  // downloads/copies once.
  const seen = new Set();
  const uniq = cues.filter((c) => {
    const k = `${c.id}:${c.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  async function fromOpenverse({ id, name }) {
    const key = `openverse:${slug(name)}`;
    let entry = openverseFor.get(key);
    if (!entry) {
      const sound = await searchOpenverseSfx(name);
      if (!sound) return null;
      const file = agentWritePath(hyperframesDir, `assets/sfx/${slug(name)}${sound.ext}`, {
        anomalies,
        taken: taken(),
      });
      try {
        await downloadTo(sound.url, join(hyperframesDir, file));
      } catch (e) {
        anomalies.push(`sfx "${name}" (id ${id}): Openverse download failed — ${e.message}`);
        return null;
      }
      fileFor.set(key, file);
      writeSfxCredit(join(destDir, "CREDITS.md"), file, sound);
      entry = {
        file,
        source: "openverse",
        duration_s: r3(sound.durationS),
        license: sound.license,
        credit: sound.credit,
      };
      openverseFor.set(key, entry);
    }
    return { id, name, ...entry, offset_s: 0, volume: SFX_VOLUME };
  }

  function fromBundled({ id, name }) {
    library ??= loadBundledLibrary(sfxLibDir);
    if (library.error) {
      anomalies.push(`sfx "${name}" (id ${id}): ${library.error} — skipped`);
      return null;
    }
    const { byKey } = library;
    const hit = byKey.get(name) ?? byKey.get(slug(name));
    if (!hit) {
      const known = [...new Set([...byKey.values()].map((v) => v.key))].slice(0, 8).join(", ");
      anomalies.push(
        `sfx "${name}" (id ${id}): not in bundled library — skipped (have: ${known}…)`,
      );
      return null;
    }
    mkdirSync(destDir, { recursive: true });
    const src = join(sfxLibDir, hit.file);
    const bytes = existsSync(src) ? readFileSync(src) : null;
    const isLibraryCopy = (rel) =>
      bytes &&
      existsSync(join(hyperframesDir, rel)) &&
      readFileSync(join(hyperframesDir, rel)).equals(bytes);
    const destRel =
      fileFor.get(hit.file) ??
      agentWritePath(hyperframesDir, `assets/sfx/${hit.file}`, {
        anomalies,
        taken: taken(),
        // An unrecorded copy of the library file is one an engine run made before the manifest had it.
        reusable: (rel) => !latestRecordFor(hyperframesDir, rel) && isLibraryCopy(rel),
      });
    const dest = join(hyperframesDir, destRel);
    // Some installs of the skill ship manifest.json without the mp3s. An entry
    // pointing at a file we never copied would silently drop downstream, so
    // skip the cue with a loud anomaly instead.
    if (bytes) {
      if (!isLibraryCopy(destRel)) copyFileSync(src, dest);
    } else if (!existsSync(dest)) {
      anomalies.push(
        `sfx "${name}" (id ${id}): bundled file ${hit.file} missing from the offline ` +
          `library (${sfxLibDir}) — skipped. Reinstall the media-use skill to ` +
          `restore assets/sfx/*.mp3.`,
      );
      return null;
    } // else the engine's earlier copy at dest stands in for the file this install lacks
    fileFor.set(hit.file, destRel);
    return {
      id,
      name,
      file: destRel,
      source: "local",
      offset_s: 0,
      duration_s: r3(hit.duration),
      volume: SFX_VOLUME,
    };
  }

  for (const cue of uniq) {
    let entry = null;
    if (!openverseDown) {
      try {
        entry = await fromOpenverse(cue);
      } catch (e) {
        if (!(e instanceof OpenverseUnavailableError)) throw e;
        openverseDown = true;
        anomalies.push(`${e.message}: the remaining SFX cues use the bundled library`);
      }
    }
    entry ??= fromBundled(cue);
    if (entry) sfx.push(entry);
  }
  return { sfx, anomalies };
}

/**
 * One sound effect for `query`, saved under the project's assets/sfx/ (the entry point for hosts).
 * { sound: { file, source, duration_s, license?, credit? } | null, anomalies }.
 */
export async function findSoundEffect(query, { hyperframesDir, sfxLibDir = BUNDLED_SFX_DIR }) {
  const { sfx, anomalies } = await resolveSfx({
    cues: [{ id: "1", name: query }],
    hyperframesDir,
    sfxLibDir,
  });
  if (!sfx.length) return { sound: null, anomalies };
  const { file, source, duration_s, license, credit } = sfx[0];
  return { sound: { file, source, duration_s, ...(license && { license, credit }) }, anomalies };
}
