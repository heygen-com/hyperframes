import { existsSync, lstatSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { AGENT_SOURCES, latestRecordFor, recordInPlace } from "../../../scripts/lib/manifest.mjs";
import { regenerateIndex } from "../../../scripts/lib/index-gen.mjs";
import { isPlainProjectPath } from "./project-path.mjs";

/**
 * Where the engine may write `rel`: there, unless another file of this run has `taken` it, a link sits there, or
 * the file there is the person's (not `reusable` and not recorded as agent-made). Then the first free
 * `name-2.ext`, with an anomaly. Throws when `rel`'s folder is not its own real folder in the project.
 */
export function agentWritePath(
  hyperframesDir,
  rel,
  { anomalies, taken = new Set(), reusable = () => false },
) {
  if (!isPlainProjectPath(hyperframesDir, dirname(rel))) {
    throw new Error(`${dirname(rel)} leads outside the project folder; nothing was written there`);
  }
  const free = (path) =>
    !taken.has(path) &&
    !lstatSync(join(hyperframesDir, path), { throwIfNoEntry: false })?.isSymbolicLink() &&
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

// A line id names its voice file, so it must be one plain file name: no folder, drive or `..`.
const isPlainFileName = (id) => id !== "" && id !== "." && id !== ".." && !/[/\\:]/.test(id);

/**
 * Each spoken line's file, picked before lines synthesize concurrently so two never land on one free name.
 * Throws for a line whose id is not a plain file name.
 */
export function voicePaths(hyperframesDir, lines, anomalies) {
  const taken = new Set();
  const paths = new Map();
  for (const line of lines.filter((l) => String(l.text ?? "").trim() || l.audio)) {
    const id = String(line.id);
    if (!isPlainFileName(id)) {
      throw new Error(
        `line id ${JSON.stringify(id)} names its voice file, so it must be a plain name: no "/", "\\" or ":", and not empty, "." or ".."`,
      );
    }
    const rel = agentWritePath(hyperframesDir, `assets/voice/${id}.wav`, { anomalies, taken });
    taken.add(rel);
    paths.set(id, rel);
  }
  return paths;
}

// A cue's source as the manifest records it, and who provided it. A source missing here records as the person's
// file, so every rerun would write a numbered copy beside it.
const SFX_SOURCES = {
  openverse: { source: "search", provider: "openverse.audio" },
  local: { source: "bundled", provider: "bundled.sfx" },
};

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
        intent: textById.get(voice.id) || "your own recording",
        duration: voice.duration_s,
        provider: voice.source ?? ttsProvider,
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
      const { source, provider } = SFX_SOURCES[cue.source];
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
