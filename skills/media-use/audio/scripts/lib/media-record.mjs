import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { AGENT_SOURCES, latestRecordFor, recordInPlace } from "../../../scripts/lib/manifest.mjs";
import { regenerateIndex } from "../../../scripts/lib/index-gen.mjs";

/**
 * Where the engine may write `rel`: there, unless another file of this run has `taken` it or the file there is
 * the person's (not `reusable` and not recorded as agent-made). Then the first free `name-2.ext`, with an anomaly.
 */
export function agentWritePath(
  hyperframesDir,
  rel,
  { anomalies, taken = new Set(), reusable = () => false },
) {
  const free = (path) =>
    !taken.has(path) &&
    (!existsSync(join(hyperframesDir, path)) ||
      reusable(path) ||
      AGENT_SOURCES.includes(latestRecordFor(hyperframesDir, path)?.source));
  if (free(rel)) return rel;
  const ext = extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  let n = 2;
  while (!free(`${stem}-${n}${ext}`)) n++;
  const path = `${stem}-${n}${ext}`;
  const why = taken.has(rel)
    ? "another file of this run goes there"
    : "the file there is yours (the media manifest does not record it as made by the engine)";
  const note = `${rel}: kept, because ${why}; writing ${path} instead (audio_meta.json has the path used)`;
  if (!anomalies.includes(note)) anomalies.push(note);
  return path;
}

/** Each spoken line's file, picked before lines synthesize concurrently so two never land on one free name. */
export function voicePaths(hyperframesDir, lines, anomalies) {
  const taken = new Set();
  const paths = new Map();
  for (const line of lines.filter((l) => String(l.text ?? "").trim())) {
    const rel = agentWritePath(hyperframesDir, `assets/voice/${line.id}.wav`, { anomalies, taken });
    taken.add(rel);
    paths.set(String(line.id), rel);
  }
  return paths;
}

const SFX_SOURCES = { heygen: "search", local: "bundled" };

// The files one engine run wrote, each with how it was made, for the project's media manifest.
export function writtenAssets({ only, lines, voices, ttsProvider, bgm, bgmFields, sfx }) {
  const textById = new Map(lines.map((line) => [String(line.id), String(line.text ?? "").trim()]));
  const assets = [];
  if (only.has("tts")) {
    for (const voice of voices) {
      assets.push({
        path: voice.path,
        type: "voice",
        source: "generated",
        intent: textById.get(voice.id),
        duration: voice.duration_s,
        provider: ttsProvider,
      });
    }
  }
  if (only.has("bgm") && bgm && !bgmFields.bgm_pending) {
    assets.push({
      path: bgm.path,
      type: "bgm",
      source: bgmFields.bgm_mode === "retrieve" ? "search" : "generated",
      intent: bgm.query,
      duration: bgm.duration_s,
      provider: bgmFields.bgm_provider,
    });
  }
  if (only.has("sfx")) {
    for (const cue of new Map(sfx.map((entry) => [entry.file, entry])).values()) {
      const source = SFX_SOURCES[cue.source];
      const provider = source === "search" ? "heygen" : "bundled.sfx";
      assets.push({
        path: cue.file,
        type: "sfx",
        source,
        intent: cue.name,
        duration: cue.duration_s,
        provider,
      });
    }
  }
  return assets;
}

/** Records each asset where it lies; returns one anomaly per file left unrecorded. */
export function recordInManifest(hyperframesDir, assets) {
  const anomalies = [];
  for (const { path, type, source, intent, duration, provider } of assets) {
    try {
      recordInPlace(hyperframesDir, {
        type,
        path,
        source,
        description: intent,
        duration,
        provenance: { provider: provider || "local", ...(intent && { prompt: intent }) },
      });
    } catch (error) {
      anomalies.push(`${path}: not recorded in the media manifest (${error.message})`);
    }
  }
  try {
    if (anomalies.length < assets.length) regenerateIndex(hyperframesDir);
  } catch (error) {
    anomalies.push(`.media/index.md: not refreshed (${error.message})`);
  }
  return anomalies;
}
