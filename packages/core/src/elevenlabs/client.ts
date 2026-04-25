export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
  labels?: Record<string, string>;
  description?: string;
}

export interface SynthesizeOptions {
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  useSpeakerBoost?: boolean;
  outputFormat?: "mp3_44100_128" | "mp3_44100_192" | "pcm_16000" | "pcm_22050" | "pcm_44100";
}

const API_BASE = "https://api.elevenlabs.io/v1";
const DEFAULT_MODEL = "eleven_turbo_v2_5";

export class ElevenLabsError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

function authHeaders(apiKey: string, accept?: string): HeadersInit {
  const h: Record<string, string> = { "xi-api-key": apiKey };
  if (accept) h.Accept = accept;
  return h;
}

async function ensureOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  let detail = "";
  try {
    const text = await res.text();
    detail = text.length > 500 ? text.slice(0, 500) + "…" : text;
  } catch {
    /* ignore */
  }
  throw new ElevenLabsError(
    `${label}: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    res.status,
  );
}

export async function listVoices(apiKey: string): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${API_BASE}/voices`, {
    headers: authHeaders(apiKey, "application/json"),
  });
  await ensureOk(res, "listVoices");
  const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
  return data.voices ?? [];
}

/** Stream the short preview MP3 for a voice. */
export async function fetchVoicePreview(
  apiKey: string,
  voiceId: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null> {
  const voices = await listVoices(apiKey);
  const voice = voices.find((v) => v.voice_id === voiceId);
  if (!voice?.preview_url) return null;

  const res = await fetch(voice.preview_url);
  await ensureOk(res, "fetchVoicePreview");
  if (!res.body) return null;
  return {
    body: res.body,
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
  };
}

/**
 * Synthesize speech. Returns the audio bytes plus the chosen output format
 * so callers can pick the right file extension.
 */
export async function synthesize(
  apiKey: string,
  text: string,
  voiceId: string,
  opts: SynthesizeOptions = {},
): Promise<{ bytes: Uint8Array; format: NonNullable<SynthesizeOptions["outputFormat"]> }> {
  const format = opts.outputFormat ?? "mp3_44100_128";
  const url = new URL(`${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set("output_format", format);

  const body = {
    text,
    model_id: opts.modelId ?? DEFAULT_MODEL,
    voice_settings: {
      stability: opts.stability ?? 0.5,
      similarity_boost: opts.similarityBoost ?? 0.75,
      style: opts.style ?? 0,
      use_speaker_boost: opts.useSpeakerBoost ?? true,
    },
  };

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...authHeaders(apiKey),
      "Content-Type": "application/json",
      Accept: format.startsWith("mp3") ? "audio/mpeg" : "audio/wav",
    },
    body: JSON.stringify(body),
  });
  await ensureOk(res, "synthesize");
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, format };
}

export function fileExtensionForFormat(format: SynthesizeOptions["outputFormat"]): string {
  if (!format || format.startsWith("mp3")) return "mp3";
  return "wav";
}
