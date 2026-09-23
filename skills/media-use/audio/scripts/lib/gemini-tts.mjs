import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const GEMINI_TTS_MODEL = "gemini-3.8-flash-tts";

export function geminiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

// Unary Interactions responses contain a complete WAV. No SDK dependency, and
// no timestamp guesses: the shared engine transcribes the saved audio.
export async function synthesizeGemini(
  { text, voiceId = "Kore", model = GEMINI_TTS_MODEL, style, speed = 1, wavAbs },
  { fetchImpl = fetch } = {},
) {
  const key = geminiKey();
  try {
    if (!key) throw new Error("Gemini TTS needs GEMINI_API_KEY or GOOGLE_API_KEY");
    if (![GEMINI_TTS_MODEL, "gemini-3.8-flash-lite-tts"].includes(model)) {
      throw new Error(`Unsupported Gemini TTS model: ${model}`);
    }
    if (speed !== 1) throw new Error("Gemini TTS uses style for pacing; omit speed or use 1");
    const content = { type: "text", text };
    if (style) content.annotations = [{ type: "speech_metadata", style }];
    const response = await fetchImpl(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model,
          input: [{ type: "user_input", content: [content] }],
          response_format: { type: "audio", mime_type: "audio/wav" },
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
    if (audio.length !== 1 || audio[0].mime_type !== "audio/wav" || !audio[0].data) {
      throw new Error("Gemini TTS returned no single WAV audio block");
    }
    const bytes = Buffer.from(audio[0].data, "base64");
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
    return { ok: false, words: null, error: key ? message.split(key).join("[redacted]") : message };
  }
}
