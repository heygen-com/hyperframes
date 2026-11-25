import { decodeAudioWithin, headerSeconds, pcmRateFor } from "@hyperframes/core/audio-decode";
import { studioApiFetch } from "./studioApiFetch";

/** A project file's preview URL (buildProjectApiPath(id, "/preview/<path>")); a clip with no project path misses. */
const PREVIEW_PATH = /^(\/api\/projects\/[^/]+)\/preview\/(.+)$/;

/** The server's PCM URL for a project file, or null for a clip with no project path. */
function pcmUrlOf(url: string, rate: number, all: boolean): string | null {
  const parsed = new URL(url, window.location.origin);
  const match = PREVIEW_PATH.exec(parsed.pathname);
  const query = `?rate=${rate}${all ? "&channels=all" : ""}`;
  return match ? `${parsed.origin}${match[1]}/pcm/${match[2]}${query}` : null;
}

/** One analysis rate for files read together: pcmRateFor their longest; a length that cannot be read counts long. */
export async function analysisRateOf(urls: string[]): Promise<number> {
  const lengths = await Promise.all(urls.map((url) => headerSeconds(url)));
  return pcmRateFor(
    lengths.some((s) => s === null) ? Infinity : Math.max(0, ...(lengths as number[])),
  );
}

type OfflineContextAt = (rate: number) => BaseAudioContext;

/** `url`'s first channel at `rate` (what the fx read): the server's for a project file, else decoded here in budget. */
export async function readPcm(
  url: string,
  rate: number,
  context: OfflineContextAt,
): Promise<Float32Array> {
  return (await readChannels(url, rate, context, false))[0]!;
}

/** Every channel of `url` at `rate`, apart: beats sum each one's power, so out-of-phase stereo can't cancel. */
export const readPcmChannels = (url: string, rate: number, context: OfflineContextAt) =>
  readChannels(url, rate, context, true);

async function readChannels(url: string, rate: number, context: OfflineContextAt, all: boolean) {
  const served = pcmUrlOf(url, rate, all);
  if (!served) {
    const decoded = await decodeAudioWithin(context(rate), url, {
      fetch: (u) => studioApiFetch(u),
    });
    const count = all ? decoded.numberOfChannels : 1;
    return Array.from({ length: count }, (_, c) => decoded.getChannelData(c));
  }
  const response = await studioApiFetch(served);
  if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
  const count = Number(response.headers.get("x-channels")) || 1;
  const bytes = await response.arrayBuffer();
  const frames = Math.floor(bytes.byteLength / 4 / count);
  if (frames < 1) throw new Error("The server sent no audio samples");
  const interleaved = new Float32Array(bytes, 0, frames * count);
  if (count === 1) return [interleaved];
  return Array.from({ length: count }, (_, c) => {
    const channel = new Float32Array(frames);
    for (let i = 0; i < frames; i++) channel[i] = interleaved[i * count + c]!;
    return channel;
  });
}
