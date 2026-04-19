/**
 * MiniMax TTS Provider
 *
 * Cloud-based text-to-speech via the MiniMax T2A (Text-to-Audio) API.
 * Requires MINIMAX_API_KEY environment variable.
 *
 * API reference: https://platform.minimax.io/docs/api-reference/speech-t2a-http
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------

export interface MiniMaxVoiceInfo {
  id: string;
  label: string;
  language: string;
  gender: "female" | "male" | "neutral";
}

export const MINIMAX_VOICES: MiniMaxVoiceInfo[] = [
  { id: "English_Graceful_Lady", label: "Graceful Lady", language: "en", gender: "female" },
  { id: "English_Insightful_Speaker", label: "Insightful Speaker", language: "en", gender: "male" },
  { id: "English_radiant_girl", label: "Radiant Girl", language: "en", gender: "female" },
  { id: "English_Persuasive_Man", label: "Persuasive Man", language: "en", gender: "male" },
  { id: "English_Lucky_Robot", label: "Lucky Robot", language: "en", gender: "neutral" },
  {
    id: "English_expressive_narrator",
    label: "Expressive Narrator",
    language: "en",
    gender: "male",
  },
];

export const MINIMAX_DEFAULT_VOICE = "English_Graceful_Lady";
export const MINIMAX_DEFAULT_MODEL = "speech-2.8-hd";
export const MINIMAX_BASE_URL = "https://api.minimax.io";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MiniMaxSynthesizeOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  speed?: number;
  onProgress?: (message: string) => void;
}

export interface MiniMaxSynthesizeResult {
  outputPath: string;
  durationSeconds: number;
}

// ---------------------------------------------------------------------------
// SSE helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Server-Sent Events stream and collect hex-encoded audio chunks.
 * The MiniMax T2A API returns audio in hex format (not base64).
 */
async function collectAudioChunks(response: Response): Promise<Buffer> {
  if (!response.body) {
    throw new Error("MiniMax TTS: response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const audioChunks: Buffer[] = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const event = JSON.parse(jsonStr) as {
          data?: { audio?: string; status?: number };
          base_resp?: { status_code: number; status_msg: string };
        };
        if (event.base_resp && event.base_resp.status_code !== 0) {
          throw new Error(
            `MiniMax TTS API error: ${event.base_resp.status_code} — ${event.base_resp.status_msg}`,
          );
        }
        // status=1: partial chunk, status=2: final summary (contains full audio, skip in streaming)
        if (event.data?.audio && event.data.status !== 2) {
          audioChunks.push(Buffer.from(event.data.audio, "hex"));
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue; // incomplete JSON, skip
        throw err;
      }
    }
  }

  if (audioChunks.length === 0) {
    throw new Error("MiniMax TTS: no audio data received from API");
  }

  return Buffer.concat(audioChunks);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synthesize text to speech using the MiniMax T2A v2 API.
 * Streams audio chunks via SSE and writes MP3 output to `outputPath`.
 */
export async function synthesizeWithMiniMax(
  text: string,
  outputPath: string,
  options?: MiniMaxSynthesizeOptions,
): Promise<MiniMaxSynthesizeResult> {
  const apiKey = options?.apiKey ?? process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    throw new Error(
      "MiniMax TTS requires MINIMAX_API_KEY environment variable. " +
        "Get your key at https://platform.minimax.io",
    );
  }

  const baseUrl = options?.baseUrl ?? MINIMAX_BASE_URL;
  const model = options?.model ?? MINIMAX_DEFAULT_MODEL;
  const voiceId = options?.voice ?? MINIMAX_DEFAULT_VOICE;
  const speed = options?.speed ?? 1.0;

  options?.onProgress?.(`Generating speech with MiniMax voice ${voiceId}...`);

  const response = await fetch(`${baseUrl}/v1/t2a_v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      text,
      stream: true,
      voice_setting: {
        voice_id: voiceId,
        speed,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: "mp3",
        channel: 1,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`MiniMax TTS request failed (${response.status}): ${body}`);
  }

  options?.onProgress?.("Receiving audio stream...");
  const audioBuffer = await collectAudioChunks(response);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, audioBuffer);

  // Estimate duration from MP3 bitrate: 128 kbps → 16 KB/s
  const durationSeconds = audioBuffer.length / (128_000 / 8);

  return { outputPath, durationSeconds: Math.round(durationSeconds * 1000) / 1000 };
}
