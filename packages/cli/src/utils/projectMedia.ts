import {
  extractAudioMetadata,
  resolveProjectRelativeSrc,
  type AudioElement,
  type VideoElement,
} from "@hyperframes/engine";
import { loadProducer } from "./producer.js";

/** The render's own media list for a project: what it extracts, probes and mixes. */
export interface ProjectMedia {
  videos: readonly Pick<VideoElement, "src" | "hasAudio" | "graded">[];
  images: readonly { src: string; graded?: boolean }[];
  gradedCanvas?: boolean;
  audios: readonly AudioElement[];
  /** The bundled document the lists were read from. */
  html: string;
}

export async function collectProjectMedia(projectDir: string): Promise<ProjectMedia> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const html = await bundleToSingleHtml(projectDir);
  const producer = (await loadProducer()) as {
    collectRenderMedia?: (source: string) => Omit<ProjectMedia, "html">;
  };
  if (!producer.collectRenderMedia) throw new Error("Render media collector unavailable");
  return { ...producer.collectRenderMedia(html), html };
}

/** The path the render reads a media `src` from: remote URLs as they are, local ones resolved like render. */
export function mediaPath(src: string, projectDir: string): string {
  return /^https?:\/\//i.test(src) ? src : resolveProjectRelativeSrc(src, projectDir, projectDir);
}

/** A clip the render mixes into the film, on the film's clock; `end` 0 means it runs to its media's end. */
export type HeardClip = Pick<
  AudioElement,
  "id" | "src" | "start" | "end" | "mediaStart" | "playbackRate" | "volume" | "type"
>;

export interface HeardProbe {
  seconds(path: string): Promise<number>;
}

const PROBE: HeardProbe = {
  seconds: async (path) => (await extractAudioMetadata(path)).durationSeconds,
};

/** Every clip the render mixes, read as the render reads them (scenes inlined, on the film's clock), each ended where
 * its media runs out if that comes first; a ramped rate or a loop keeps its end. */
export async function heardClips(
  projectDir: string,
  probe: HeardProbe = PROBE,
): Promise<HeardClip[]> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const { audios } = (await loadProducer()).collectRenderMedia(
    await bundleToSingleHtml(projectDir),
  );
  return Promise.all(audios.map((clip) => endedClip(clip, projectDir, probe)));
}

async function endedClip(
  clip: AudioElement,
  projectDir: string,
  probe: HeardProbe,
): Promise<HeardClip> {
  const { id, src, start, mediaStart, playbackRate, volume, type } = clip;
  const heard = { id, src, start, end: clip.end, mediaStart, playbackRate, volume, type };
  const rate = playbackRate === undefined ? 1 : playbackRate;
  if (clip.loop || typeof rate !== "number" || !(rate > 0)) return heard;
  const seconds = await probe.seconds(mediaPath(src, projectDir)).catch(() => null);
  if (seconds === null || seconds <= mediaStart) return heard;
  const runsOut = start + (seconds - mediaStart) / rate;
  return { ...heard, end: clip.end > 0 ? Math.min(clip.end, runsOut) : runsOut };
}
