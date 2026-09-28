import { recordInPlace } from "../../../scripts/lib/manifest.mjs";
import { regenerateIndex } from "../../../scripts/lib/index-gen.mjs";

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
      assets.push({ path: cue.file, type: "sfx", source, intent: cue.name, duration: cue.duration_s, provider });
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
  if (anomalies.length < assets.length) regenerateIndex(hyperframesDir);
  return anomalies;
}
