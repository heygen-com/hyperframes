import type { TimedWord } from "./types.js";

interface ElevenLabsAlignment {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
}

interface ElevenLabsResponse {
  audio_base64?: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
}

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY?.trim() || "";
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_multilingual_v2";
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT?.trim() || "";

function resolveVoiceId(style: "energetic_american" | "calm_executive" | "documentary") {
  const styleSpecific =
    style === "energetic_american"
      ? process.env.ELEVENLABS_VOICE_ID_ENERGETIC_AMERICAN
      : style === "calm_executive"
        ? process.env.ELEVENLABS_VOICE_ID_CALM_EXECUTIVE
        : process.env.ELEVENLABS_VOICE_ID_DOCUMENTARY;
  const voiceId = styleSpecific?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || "";
  if (!voiceId) {
    throw new Error(`Missing ElevenLabs voice id for style ${style}`);
  }
  return voiceId;
}

function finalizeWord(words: TimedWord[], text: string, start: number | null, end: number | null) {
  const normalized = text.trim();
  if (!normalized || start === null || end === null) return;
  words.push({
    text: normalized,
    start,
    end,
  });
}

function wordsFromAlignment(alignment: ElevenLabsAlignment | null | undefined) {
  const chars = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const words: TimedWord[] = [];

  let current = "";
  let wordStart: number | null = null;
  let wordEnd: number | null = null;

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    if (!char) continue;
    const start: number = starts[index] ?? wordEnd ?? 0;
    const end: number = ends[index] ?? start;
    if (/\s/.test(char)) {
      finalizeWord(words, current, wordStart, wordEnd);
      current = "";
      wordStart = null;
      wordEnd = null;
      continue;
    }

    current += char;
    if (wordStart === null) wordStart = start;
    wordEnd = end;
  }

  finalizeWord(words, current, wordStart, wordEnd);
  return words;
}

export async function synthesizeSpeechWithTimestamps(args: {
  text: string;
  style: "energetic_american" | "calm_executive" | "documentary";
  seed: number;
}) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }

  const voiceId = resolveVoiceId(args.style);
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`);
  if (ELEVENLABS_OUTPUT_FORMAT) {
    url.searchParams.set("output_format", ELEVENLABS_OUTPUT_FORMAT);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": ELEVENLABS_API_KEY,
    },
    body: JSON.stringify({
      text: args.text,
      model_id: ELEVENLABS_MODEL_ID,
      seed: args.seed,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs request failed (${response.status}): ${raw.slice(0, 400)}`);
  }

  const parsed = JSON.parse(raw) as ElevenLabsResponse;
  if (!parsed.audio_base64) {
    throw new Error("ElevenLabs response missing audio_base64");
  }

  const audio = Buffer.from(parsed.audio_base64, "base64");
  const words = wordsFromAlignment(parsed.alignment || parsed.normalized_alignment);
  if (!words.length) {
    throw new Error("ElevenLabs response missing usable timestamp alignment");
  }

  return {
    audio,
    mimeType: "audio/mpeg",
    modelId: ELEVENLABS_MODEL_ID,
    voiceId,
    words,
  };
}
