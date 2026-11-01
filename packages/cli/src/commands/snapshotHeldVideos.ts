import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { MEDIA_RENDER_ID_ATTR } from "@hyperframes/core";
import { findFFprobe } from "../browser/ffmpeg.js";
import { runCancellableProcess } from "../utils/cancellableProcess.js";

const REMOTE_OR_INLINE_SRC = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** Ids of the videos that play a project file: snapshot reads their frames with FFmpeg, so Chrome need not decode them. */
export function localVideoRenderIds(html: string): string[] {
  const ids = new Set<string>();
  for (const video of parseHTML(html).document.querySelectorAll("video")) {
    const src = video.getAttribute("src") ?? video.querySelector("source")?.getAttribute("src");
    const id = video.getAttribute(MEDIA_RENDER_ID_ATTR) || video.id;
    if (id && src && !REMOTE_OR_INLINE_SRC.test(src.trim())) ids.add(id);
  }
  return [...ids];
}

/** The project file a page URL names, or null when it is remote or outside the project. */
export function projectLocalFile(projectDir: string, src: string): string | null {
  try {
    const path = decodeURIComponent(new URL(src).pathname).replace(/^\//, "");
    const file = resolve(projectDir, path);
    const rel = relative(projectDir, file);
    return !rel.startsWith("..") && !isAbsolute(rel) && existsSync(file) ? file : null;
  } catch {
    return null;
  }
}

const DURATION_PROBE_TIMEOUT_MS = 30_000;

/** A file's duration in seconds from FFprobe, or 0 when it cannot be read; each file is probed once. */
export function probeSourceDuration(
  path: string,
  cache: Map<string, Promise<number>>,
  ffprobe = findFFprobe(),
): Promise<number> {
  const known = cache.get(path);
  if (known) return known;
  const read = (async () => {
    if (!ffprobe) return 0;
    try {
      const { stdout } = await runCancellableProcess(
        ffprobe,
        ["-v", "error", "-show_entries", "format=duration", "-of", "json", "--", path],
        { timeoutMs: DURATION_PROBE_TIMEOUT_MS, maxBufferBytes: 1024 * 1024 },
      );
      const seconds = Number(
        (JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration,
      );
      return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    } catch {
      return 0;
    }
  })();
  cache.set(path, read);
  return read;
}
