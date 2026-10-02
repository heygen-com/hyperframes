import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { geminiAuth } from "./gemini-auth.mjs";

export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";

export const GEMINI_TTS_MODELS = [
  GEMINI_TTS_MODEL,
  "gemini-3.8-flash-lite-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-preview-tts",
  "gemini-2.5-flash-preview-tts",
];

// 3.8 returns WAV; older models return PCM that we wrap without resampling.
// The shared engine transcribes the saved audio for word timings.
export async function synthesizeGemini(
  { text, voiceId = "Kore", model = GEMINI_TTS_MODEL, style, speed = 1, wavAbs },
  { fetchImpl = fetch, authenticate = geminiAuth } = {},
) {
  let secret;
  try {
    if (!GEMINI_TTS_MODELS.includes(model)) {
      throw new Error(`Unsupported Gemini TTS model: ${model}`);
    }
    if (speed !== 1) throw new Error("Gemini TTS uses style for pacing; omit speed or use 1");
    const modern = model.startsWith("gemini-3.8-");
    if (!modern && /^(voice_|voicekey_)/.test(voiceId)) {
      throw new Error(
        "Custom Gemini voices require a 3.8 TTS model; use a prebuilt voice with older models",
      );
    }
    const auth = authenticate();
    secret = auth.secret;
    const content = {
      type: "text",
      text:
        !modern && style ? `Read the following text with this delivery: ${style}\n\n${text}` : text,
    };
    if (modern && style) content.annotations = [{ type: "speech_metadata", style }];
    const response = await fetchImpl(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth.headers },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model,
          input: [{ type: "user_input", content: [content] }],
          response_format: modern ? { type: "audio", mime_type: "audio/wav" } : { type: "audio" },
          generation_config: { speech_config: [{ voice: voiceId }] },
          store: false,
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini TTS HTTP ${response.status}: ${detail}`);
    }
    const payload = await response.json();
    if (payload.status !== "completed") {
      throw new Error(`Gemini TTS did not complete (${payload.status ?? "missing status"})`);
    }
    const audio = (payload.steps ?? [])
      .filter((step) => step.type === "model_output")
      .flatMap((step) => step.content ?? [])
      .filter((part) => part.type === "audio");
    if (audio.length !== 1 || !audio[0].data) {
      throw new Error("Gemini TTS returned no single audio block");
    }
    let bytes = Buffer.from(audio[0].data, "base64");
    if (!modern && /^audio\/l16(?:;|$)/i.test(audio[0].mime_type ?? "")) {
      bytes = pcmToWav(bytes, audio[0].mime_type);
    } else if (audio[0].mime_type !== "audio/wav") {
      throw new Error("Gemini TTS returned an unsupported audio format");
    }
    if (
      bytes.length <= 44 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE"
    ) {
      throw new Error("Gemini TTS returned invalid WAV audio");
    }
    mkdirSync(dirname(wavAbs), { recursive: true });
    writeFileSync(wavAbs, bytes);
    return { ok: true, words: null };
  } catch (error) {
    // Error responses must never echo the credential into logs or metadata.
    const message = String(error?.message ?? error);
    return {
      ok: false,
      words: null,
      error: secret ? message.split(secret).join("[redacted]") : message,
    };
  }
}

function pcmToWav(pcm, mime) {
  const rate = Number(/(?:^|;)\s*rate=(\d+)(?:;|$)/i.exec(mime)?.[1]);
  const channels = /(?:^|;)\s*channels=([^;]+)/i.exec(mime)?.[1];
  const codec = /(?:^|;)\s*codec=([^;]+)/i.exec(mime)?.[1];
  if ((channels && channels.trim() !== "1") || (codec && codec.trim() !== "pcm")) {
    throw new Error("Gemini TTS returned unsupported PCM channels or codec");
  }
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || !pcm.length || pcm.length % 2) {
    throw new Error("Gemini TTS returned invalid PCM audio or sample rate");
  }
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
