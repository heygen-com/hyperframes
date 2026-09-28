import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { AGENT_SOURCES, latestRecordFor, recordInPlace } from "../../../scripts/lib/manifest.mjs";
import { regenerateIndex } from "../../../scripts/lib/index-gen.mjs";

/**
 * Where the engine may write `rel`: there, unless a file the person put there already is (one the manifest does
 * not record as agent-made, not written earlier in this run, and not `reusable`); then the first such
 * `name-2.ext`, `name-3.ext`.
 */
export function agentWritePath(hyperframesDir, rel, writtenThisRun = new Set(), reusable = () => false) {
  const personal = (path) =>
    existsSync(join(hyperframesDir, path)) &&
    !writtenThisRun.has(path) &&
    !reusable(path) &&
    !AGENT_SOURCES.includes(latestRecordFor(hyperframesDir, path)?.source);
  if (!personal(rel)) return rel;
  const ext = extname(rel);
  for (let n = 2; ; n++) {
    const candidate = `${rel.slice(0, rel.length - ext.length)}-${n}${ext}`;
    if (!personal(candidate)) return candidate;
  }
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
      if (!source) continue;
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
