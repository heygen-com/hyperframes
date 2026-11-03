import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import type { CaptureVideoMetadataHint } from "@hyperframes/engine";
import { findFFprobe } from "../browser/ffmpeg.js";
import { runCancellableProcess } from "../utils/cancellableProcess.js";

const REMOTE_OR_INLINE_SRC = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** The videos that play a project file: snapshot reads their frames with FFmpeg, so Chrome need not decode them. */
export function localVideos(html: string): { id: string; src: string }[] {
  const videos = new Map<string, string>();
  for (const video of parseHTML(html).document.querySelectorAll("video")) {
    const src = video.getAttribute("src") ?? video.querySelector("source")?.getAttribute("src");
    const id = video.getAttribute(MEDIA_RENDER_ID_ATTR) || video.id;
    if (id && src && !REMOTE_OR_INLINE_SRC.test(src.trim())) videos.set(id, src);
  }
  return [...videos].map(([id, src]) => ({ id, src }));
}

export const localVideoRenderIds = (html: string): string[] => localVideos(html).map((v) => v.id);

/** The project file a page URL names, or null when it is remote or outside the project. */
export function projectLocalFile(projectDir: string, src: string): string | null {
  try {
    const path = decodeURIComponent(new URL(src, "http://project.invalid/").pathname).replace(
      /^\//,
      "",
    );
    const file = resolve(projectDir, path);
    const rel = relative(projectDir, file);
    return !rel.startsWith("..") && !isAbsolute(rel) && existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

const PROBE_TIMEOUT_MS = 30_000;

export interface HeldVideoProbe {
  duration: number;
  /** The size Chrome would lay the video out at: rotated footage swaps its coded width and height. */
  width: number;
  height: number;
}

const UNKNOWN_VIDEO: HeldVideoProbe = { duration: 0, width: 0, height: 0 };

interface ProbeJson {
  format?: { duration?: string };
  streams?: {
    width?: number;
    height?: number;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
  }[];
}

function parseProbe(json: ProbeJson): HeldVideoProbe {
  const duration = Number(json.format?.duration);
  const stream = json.streams?.[0];
  const rotation = Number(
    stream?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
      stream?.tags?.rotate ??
      0,
  );
  const turned = Math.abs(rotation) % 180 === 90;
  const [width, height] = [Number(stream?.width), Number(stream?.height)];
  const sized = width > 0 && height > 0;
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    width: sized ? (turned ? height : width) : 0,
    height: sized ? (turned ? width : height) : 0,
  };
}

/** A file's duration and display size from FFprobe, zeros when it cannot be read; each file is probed once. */
export function probeHeldVideo(
  path: string,
  cache: Map<string, Promise<HeldVideoProbe>>,
  ffprobe = findFFprobe(),
): Promise<HeldVideoProbe> {
  const known = cache.get(path);
  if (known) return known;
  const read = (async () => {
    if (!ffprobe) return UNKNOWN_VIDEO;
    try {
      const { stdout } = await runCancellableProcess(
        ffprobe,
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "format=duration:stream=width,height:stream_tags=rotate:stream_side_data=rotation",
          "-of",
          "json",
          "--",
          path,
        ],
        { timeoutMs: PROBE_TIMEOUT_MS, maxBufferBytes: 1024 * 1024 },
      );
      return parseProbe(JSON.parse(stdout) as ProbeJson);
    } catch {
      return UNKNOWN_VIDEO;
    }
  })();
  cache.set(path, read);
  return read;
}

/** The intrinsic sizes render gives held videos, so a `height:auto` clip keeps its layout. */
export async function heldVideoHints(
  projectDir: string,
  videos: readonly { id: string; src: string }[],
  cache: Map<string, Promise<HeldVideoProbe>>,
  ffprobe = findFFprobe(),
): Promise<CaptureVideoMetadataHint[]> {
  const hints = await Promise.all(
    videos.map(async ({ id, src }) => {
      const file = projectLocalFile(projectDir, src);
      const { width, height } = file ? await probeHeldVideo(file, cache, ffprobe) : UNKNOWN_VIDEO;
      return width > 0 && height > 0 ? { id, width, height } : null;
    }),
  );
  return hints.filter((hint): hint is CaptureVideoMetadataHint => hint !== null);
}
