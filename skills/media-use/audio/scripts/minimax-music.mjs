#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { miniMaxMusicOptionsFromRequest, writeMiniMaxMusic } from "./lib/minimax-music.mjs";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const booleanFlag = (name, fallback) => (has(name) ? true : has(`no-${name}`) ? false : fallback);

const outputPath = flag("output", "");
if (!outputPath) throw new Error("--output is required");

const requestPath = flag("request", "");
let requestOptions = {};
if (requestPath) {
  const request = JSON.parse(readFileSync(resolve(requestPath), "utf8"));
  requestOptions = miniMaxMusicOptionsFromRequest(request.bgm);
}

const model = flag("model", requestOptions.model ?? process.env.MINIMAX_MUSIC_MODEL ?? "music-3.0");
const lyrics = flag("lyrics", requestOptions.lyrics);
const audioSetting = requestOptions.audioSetting ?? {};
await writeMiniMaxMusic({
  outputPath: resolve(outputPath),
  model,
  region: flag("region", requestOptions.region ?? process.env.MINIMAX_API_REGION ?? "global_en"),
  prompt: flag("prompt", requestOptions.prompt),
  lyrics,
  stream: booleanFlag("stream", requestOptions.stream ?? false),
  outputFormat: flag("output-format", requestOptions.outputFormat ?? "hex"),
  audioFormat: flag("audio-format", audioSetting.format ?? "wav"),
  audioSetting,
  lyricsOptimizer: booleanFlag("lyrics-optimizer", requestOptions.lyricsOptimizer),
  isInstrumental: booleanFlag("instrumental", requestOptions.isInstrumental ?? !lyrics),
  audioUrl: flag("audio-url", requestOptions.audioUrl),
  audioBase64: flag("audio-base64", requestOptions.audioBase64),
  coverFeatureId: flag("cover-feature-id", requestOptions.coverFeatureId),
  aigcWatermark: booleanFlag("aigc-watermark", requestOptions.aigcWatermark),
});
