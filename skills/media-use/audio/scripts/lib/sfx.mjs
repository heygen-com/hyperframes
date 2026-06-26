// sfx.mjs — sound effects for the media audio engine. Provider-gated (NOT a
// per-cue merge): the decision is made once, by whether HeyGen is configured —
// mirroring how TTS and BGM degrade.
//
//   HeyGen credential present  →  retrieve EVERY cue from HeyGen's audio library
//        (/v3/audio/sounds, type=sound_effects, min_score=0.4). The bundled
//        library is NOT consulted.
//   HeyGen credential absent   →  resolve cues against the bundled 21-file
//        library (assets/sfx/manifest.json), copying matched files into the
//        project. Offline, deterministic, free.
//
// A cue that matches nothing is skipped (recorded as an anomaly); SFX never
// blocks a render. Every cue sits at volume ~0.35, under voice + BGM.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { downloadTo, searchSounds } from "./heygen.mjs";

const SFX_VOLUME = 0.35;
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "x";
const r3 = (x) => Number(x.toFixed(3));

// cues: [{ id, name }] (id = the line/frame/scene the cue fires in). Returns
// { sfx: [{ id, name, file, source, offset_s, duration_s, volume }], anomalies }.
export async function resolveSfx({ cues, heygenOK, headers, hyperframesDir, sfxLibDir }) {
  const sfx = [];
  const anomalies = [];
  const destDir = join(hyperframesDir, "assets", "sfx");

  // Dedupe identical (id,name) cues — the same effect named twice in one line
  // downloads/copies once.
  const seen = new Set();
  const uniq = cues.filter((c) => {
    const k = `${c.id}:${c.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (heygenOK) {
    for (const { id, name } of uniq) {
      try {
        // SFX hits score low (~0.5–0.67), below the API's default 0.7 which
        // silently drops most named cues — floor to 0.4. (BGM/music score high
        // and keep the default.)
        const results = await searchSounds(name, "sound_effects", headers, {
          limit: 3,
          minScore: 0.4,
        });
        if (!results.length) {
          anomalies.push(`sfx "${name}" (id ${id}): no HeyGen match — skipped`);
          continue;
        }
        const top = results[0];
        const file = `assets/sfx/${slug(name)}.mp3`;
        await downloadTo(top.audio_url, join(hyperframesDir, file));
        sfx.push({
          id,
          name,
          file,
          source: "heygen",
          offset_s: 0,
          duration_s: typeof top.duration === "number" ? r3(top.duration) : 1.0,
          volume: SFX_VOLUME,
        });
      } catch (e) {
        anomalies.push(`sfx "${name}" (id ${id}): retrieval failed — ${e.message}`);
      }
    }
    return { sfx, anomalies };
  }

  // ── offline: bundled library ──
  const manifestPath = join(sfxLibDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    if (uniq.length)
      anomalies.push(`no HeyGen credential and no SFX library at ${sfxLibDir} — all cues dropped`);
    return { sfx, anomalies };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    anomalies.push(`SFX manifest parse failed (${e.message}) — all cues dropped`);
    return { sfx, anomalies };
  }
  // Build lookups: by manifest key, by file basename, and by slug of either, so
  // a cue can name "whoosh", "whoosh.mp3", or "ui click" (→ slug match).
  const byKey = new Map();
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry?.file || !isFinite(entry.duration)) continue;
    const rec = { key, file: entry.file, duration: entry.duration };
    byKey.set(key, rec);
    byKey.set(entry.file, rec);
    byKey.set(slug(key), rec);
    byKey.set(slug(entry.file.replace(/\.\w+$/, "")), rec);
  }
  mkdirSync(destDir, { recursive: true });
  for (const { id, name } of uniq) {
    const hit = byKey.get(name) ?? byKey.get(slug(name));
    if (!hit) {
      const known = [...new Set([...byKey.values()].map((v) => v.key))].slice(0, 8).join(", ");
      anomalies.push(
        `sfx "${name}" (id ${id}): not in bundled library — skipped (have: ${known}…)`,
      );
      continue;
    }
    const src = join(sfxLibDir, hit.file);
    const destRel = `assets/sfx/${hit.file}`;
    const dest = join(hyperframesDir, destRel);
    if (existsSync(src) && !existsSync(dest)) copyFileSync(src, dest);
    sfx.push({
      id,
      name,
      file: destRel,
      source: "local",
      offset_s: 0,
      duration_s: r3(hit.duration),
      volume: SFX_VOLUME,
    });
  }
  return { sfx, anomalies };
}
