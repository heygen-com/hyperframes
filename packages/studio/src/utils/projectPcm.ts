import { decodeAudioWithin, headerSeconds, pcmRateFor } from "@hyperframes/core/audio-decode";
import { studioApiFetch } from "./studioApiFetch";

/** A project file's preview URL (buildProjectApiPath(id, "/preview/<path>")); a clip with no project path misses. */
const PREVIEW_PATH = /^(\/api\/projects\/[^/]+)\/preview\/(.+)$/;

/** The server's PCM URL for a project file, or null for a clip with no project path. */
function pcmUrlOf(url: string, rate: number, mix = false): string | null {
  const parsed = new URL(url, window.location.origin);
  const match = PREVIEW_PATH.exec(parsed.pathname);
  const query = `?rate=${rate}${mix ? "&mix=1" : ""}`;
  return match ? `${parsed.origin}${match[1]}/pcm/${match[2]}${query}` : null;
}

/** One analysis rate for files read together: pcmRateFor their longest; a length that cannot be read counts long. */
export async function analysisRateOf(urls: string[]): Promise<number> {
  const lengths = await Promise.all(urls.map((url) => headerSeconds(url)));
  return pcmRateFor(
    lengths.some((s) => s === null) ? Infinity : Math.max(0, ...(lengths as number[])),
  );
}

/** `url` at `rate` (first channel, or all mixed): the server's for a project file, else decoded here in budget. */
export async function readPcm(
  url: string,
  rate: number,
  offlineContext: (rate: number) => BaseAudioContext,
  mix = false,
): Promise<Float32Array> {
  const served = pcmUrlOf(url, rate, mix);
  if (!served) {
    const decoded = await decodeAudioWithin(offlineContext(rate), url, {
      fetch: (u) => studioApiFetch(u),
    });
    return mix ? mixDown(decoded) : decoded.getChannelData(0);
  }
  const response = await studioApiFetch(served);
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 4) throw new Error("The server sent no audio samples");
  return new Float32Array(bytes, 0, bytes.byteLength >> 2);
}

function mixDown(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i]! += channel[i]! / buffer.numberOfChannels;
  }
  return out;
}
