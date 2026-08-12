#!/usr/bin/env node

import { resolve } from "node:path";
import { writeMiniMaxMusic } from "./lib/minimax-music.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const outputPath = flag("output", "");
if (!outputPath) throw new Error("--output is required");

const lyrics = flag("lyrics", undefined);
await writeMiniMaxMusic({
  outputPath: resolve(outputPath),
  model: flag("model", process.env.MINIMAX_MUSIC_MODEL || "music-3.0"),
  region: flag("region", process.env.MINIMAX_API_REGION || "global_en"),
  prompt: flag("prompt", undefined),
  lyrics,
  stream: has("stream"),
  outputFormat: flag("output-format", "hex"),
  audioFormat: flag("audio-format", "wav"),
  lyricsOptimizer: has("lyrics-optimizer") ? true : has("no-lyrics-optimizer") ? false : undefined,
  isInstrumental: has("instrumental") ? true : has("no-instrumental") ? false : !lyrics,
  aigcWatermark: has("aigc-watermark") ? true : has("no-aigc-watermark") ? false : undefined,
});
