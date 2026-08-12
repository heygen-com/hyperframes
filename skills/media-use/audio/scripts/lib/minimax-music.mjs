import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const MINIMAX_MUSIC_ENDPOINTS = Object.freeze({
  global_en: "https://api.minimax.io/v1/music_generation",
  cn_zh: "https://api.minimaxi.com/v1/music_generation",
});

export const MINIMAX_MUSIC_MODELS = Object.freeze({
  generation: Object.freeze(["music-3.0", "music-2.6", "music-3.0-free", "music-2.6-free"]),
  cover: Object.freeze(["music-cover", "music-cover-free"]),
});

export const MINIMAX_MUSIC_DEFAULT_MODEL = "music-3.0";
export const MINIMAX_MUSIC_OUTPUT_FORMATS = Object.freeze(["url", "hex"]);
export const MINIMAX_MUSIC_STREAM_OUTPUT_FORMATS = Object.freeze(["hex"]);
export const MINIMAX_MUSIC_AUDIO_FORMATS = Object.freeze(["mp3", "wav", "pcm"]);
export const MINIMAX_MUSIC_URL_TTL_HOURS = 24;
export const MINIMAX_MUSIC_COVER_LIMITS = Object.freeze({
  inputMinSeconds: 6,
  inputMaxSeconds: 360,
  inputMaxBytes: 50 * 1024 * 1024,
});

const ALL_MODELS = new Set([...MINIMAX_MUSIC_MODELS.generation, ...MINIMAX_MUSIC_MODELS.cover]);
const COVER_MODELS = new Set(MINIMAX_MUSIC_MODELS.cover);

function requireChoice(value, choices, label) {
  if (!choices.includes(value)) {
    throw new Error(`Unsupported MiniMax music ${label}: ${value}`);
  }
}

export function miniMaxMusicOptionsFromRequest(bgm = {}) {
  if (!bgm || typeof bgm !== "object") bgm = {};
  return {
    model: bgm.model,
    region: bgm.region,
    prompt: bgm.prompt,
    lyrics: bgm.lyrics,
    stream: bgm.stream,
    outputFormat: bgm.output_format,
    audioSetting: bgm.audio_setting,
    lyricsOptimizer: bgm.lyrics_optimizer,
    isInstrumental: bgm.is_instrumental,
    audioUrl: bgm.audio_url,
    audioBase64: bgm.audio_base64,
    coverFeatureId: bgm.cover_feature_id,
    aigcWatermark: bgm.aigc_watermark,
  };
}

export function resolveMiniMaxMusicEndpoint(region = "global_en") {
  const endpoint = MINIMAX_MUSIC_ENDPOINTS[region];
  if (!endpoint) throw new Error(`Unsupported MiniMax music region: ${region}`);
  return endpoint;
}

export function buildMiniMaxMusicRequest({
  model = MINIMAX_MUSIC_DEFAULT_MODEL,
  prompt,
  lyrics,
  stream = false,
  outputFormat = "hex",
  audioFormat = "wav",
  audioSetting = {},
  lyricsOptimizer,
  isInstrumental,
  audioUrl,
  audioBase64,
  coverFeatureId,
  region = "global_en",
  aigcWatermark,
} = {}) {
  if (!ALL_MODELS.has(model)) throw new Error(`Unsupported MiniMax music model: ${model}`);
  requireChoice(outputFormat, MINIMAX_MUSIC_OUTPUT_FORMATS, "output format");
  requireChoice(audioFormat, MINIMAX_MUSIC_AUDIO_FORMATS, "audio format");
  if (stream)
    requireChoice(outputFormat, MINIMAX_MUSIC_STREAM_OUTPUT_FORMATS, "stream output format");
  resolveMiniMaxMusicEndpoint(region);

  const hasAudioUrl = typeof audioUrl === "string" && audioUrl.length > 0;
  const hasAudioBase64 = typeof audioBase64 === "string" && audioBase64.length > 0;
  if (COVER_MODELS.has(model) && hasAudioUrl === hasAudioBase64) {
    throw new Error("MiniMax music cover requires exactly one of audioUrl or audioBase64");
  }
  if (hasAudioBase64) {
    const encoded = audioBase64.replace(/^data:[^;]+;base64,/, "");
    const inputBytes = Buffer.from(encoded, "base64").byteLength;
    if (inputBytes > MINIMAX_MUSIC_COVER_LIMITS.inputMaxBytes) {
      throw new Error("MiniMax music cover input exceeds 50 MB");
    }
  }

  const request = {
    model,
    stream,
    output_format: outputFormat,
    audio_setting: { ...audioSetting, format: audioFormat },
  };
  if (prompt !== undefined) request.prompt = prompt;
  if (lyrics !== undefined) request.lyrics = lyrics;
  if (lyricsOptimizer !== undefined) request.lyrics_optimizer = lyricsOptimizer;
  if (isInstrumental !== undefined) request.is_instrumental = isInstrumental;
  if (hasAudioUrl) request.audio_url = audioUrl;
  if (hasAudioBase64) request.audio_base64 = audioBase64;
  if (coverFeatureId !== undefined) request.cover_feature_id = coverFeatureId;
  if (region === "cn_zh" && aigcWatermark !== undefined) {
    request.aigc_watermark = aigcWatermark;
  }
  return request;
}

function assertSuccessfulPayload(payload) {
  const statusCode = payload?.base_resp?.status_code;
  if (statusCode !== 0) {
    const message = payload?.base_resp?.status_msg || "unknown error";
    throw new Error(`MiniMax music API error ${statusCode ?? "unknown"}: ${message}`);
  }
}

export function parseMiniMaxMusicResponse(payload) {
  assertSuccessfulPayload(payload);
  const status = payload?.data?.status;
  if (status !== 1 && status !== 2) {
    throw new Error(`Unexpected MiniMax music status: ${status ?? "missing"}`);
  }
  const audio = payload?.data?.audio;
  if (typeof audio !== "string" || audio.length === 0) {
    throw new Error("MiniMax music response did not include audio");
  }
  return { audio, status, completed: status === 2 };
}

export function parseMiniMaxMusicStream(text) {
  const partialAudio = [];
  let completedAudio = "";
  let status = 1;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const payload = JSON.parse(data);
    assertSuccessfulPayload(payload);
    const nextStatus = payload?.data?.status;
    if (nextStatus === 1 || nextStatus === 2) status = nextStatus;
    const audio = payload?.data?.audio;
    if (typeof audio !== "string" || audio.length === 0) continue;
    if (nextStatus === 2) completedAudio = audio;
    else partialAudio.push(audio);
  }
  const audio = partialAudio.length > 0 ? partialAudio.join("") : completedAudio;
  if (!audio) throw new Error("MiniMax music stream did not include audio");
  return { audio, status, completed: status === 2 };
}

function decodeHexAudio(value) {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw new Error("MiniMax music response contained invalid hex audio");
  }
  return Buffer.from(value, "hex");
}

export async function generateMiniMaxMusic({
  apiKey = process.env.MINIMAX_API_KEY,
  fetchImpl = globalThis.fetch,
  endpoint,
  ...options
} = {}) {
  if (!apiKey) throw new Error("MINIMAX_API_KEY is required for MiniMax music generation");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required");

  const region = options.region ?? process.env.MINIMAX_API_REGION ?? "global_en";
  const request = buildMiniMaxMusicRequest({ ...options, region });
  const response = await fetchImpl(endpoint ?? resolveMiniMaxMusicEndpoint(region), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`MiniMax music request failed with HTTP ${response.status}`);

  const result = request.stream
    ? parseMiniMaxMusicStream(await response.text())
    : parseMiniMaxMusicResponse(await response.json());
  if (request.output_format === "url") return { ...result, audioUrl: result.audio };
  return { ...result, audioBytes: decodeHexAudio(result.audio) };
}

export async function writeMiniMaxMusic({ outputPath, fetchImpl = globalThis.fetch, ...options }) {
  if (!outputPath) throw new Error("An output path is required for MiniMax music generation");
  const result = await generateMiniMaxMusic({ ...options, fetchImpl });
  let audio = result.audioBytes;
  if (!audio && result.audioUrl) {
    const response = await fetchImpl(result.audioUrl);
    if (!response.ok) throw new Error(`MiniMax music download failed with HTTP ${response.status}`);
    audio = Buffer.from(await response.arrayBuffer());
  }
  if (!audio) throw new Error("MiniMax music generation produced no writable audio");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, audio);
  return { outputPath, status: result.status, completed: result.completed };
}
