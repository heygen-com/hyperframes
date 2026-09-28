import { spawnP } from "./tts.mjs";

// The files one engine run wrote, each with how it was made, for the project's media manifest.
export function writtenAssets({ only, lines, voices, bgm, bgmFields, sfx }) {
  const textById = new Map(lines.map((line) => [String(line.id), String(line.text ?? "").trim()]));
  const assets = [];
  if (only.has("tts")) {
    for (const voice of voices) {
      assets.push({
        path: voice.path,
        type: "voice",
        source: "generated",
        intent: textById.get(voice.id),
      });
    }
  }
  if (only.has("bgm") && bgm && !bgmFields.bgm_pending) {
    const source = bgmFields.bgm_mode === "generate" ? "generated" : "search";
    assets.push({ path: bgm.path, type: "bgm", source, intent: bgm.query });
  }
  if (only.has("sfx")) {
    for (const cue of new Map(sfx.map((entry) => [entry.file, entry])).values()) {
      const source = cue.source === "heygen" ? "search" : "bundled";
      assets.push({ path: cue.file, type: "sfx", source, intent: cue.name });
    }
  }
  return assets;
}

// Through `hyperframes media-use`, the manifest's one writer, one file at a time since it numbers records by reading
// the manifest. Returns one anomaly per file left unrecorded.
export async function recordInManifest(hyperframesDir, assets, spawn = spawnP) {
  const anomalies = [];
  for (const { path, type, source, intent } of assets) {
    const args = ["hyperframes", "media-use", "resolve", "--from", path, "--type", type];
    args.push("--source", source, "--project", ".", ...(intent ? ["--intent", intent] : []));
    const { status } = await spawn("npx", args, { cwd: hyperframesDir });
    if (status !== 0)
      anomalies.push(`${path}: not recorded in the media manifest (exit ${status})`);
  }
  return anomalies;
}
