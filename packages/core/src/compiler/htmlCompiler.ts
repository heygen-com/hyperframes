import { resolve } from "path";
import {
  compileTimingAttrs,
  injectDurations,
  extractResolvedMedia,
  clampDurations,
  type ResolvedDuration,
} from "./timingCompiler";

/**
 * Callback to probe media duration. If not provided, media duration resolution is skipped.
 * Return duration in seconds, or 0 if unknown.
 */
export type MediaDurationProber = (src: string) => Promise<number>;

function resolveMediaSrc(src: string, projectDir: string): string {
  return src.startsWith("http://") || src.startsWith("https://")
    ? src
    : resolve(projectDir, src);
}

/**
 * Compile HTML with full duration resolution.
 *
 * 1. Static pass: compileTimingAttrs() adds data-end where data-duration exists
 * 2. For unresolved video/audio (no data-duration): probe via probeMediaDuration, inject durations
 * 3. For pre-resolved video/audio: validate data-duration against actual source, clamp if needed
 *
 * @param rawHtml - The raw HTML string
 * @param projectDir - The project directory for resolving relative paths
 * @param probeMediaDuration - Optional callback to probe media duration (e.g., via ffprobe)
 */
export async function compileHtml(
  rawHtml: string,
  projectDir: string,
  probeMediaDuration?: MediaDurationProber,
): Promise<string> {
  const { html: staticCompiled, unresolved } = compileTimingAttrs(rawHtml);
  let html = staticCompiled;

  if (!probeMediaDuration) return html;

  // Phase 1: Resolve missing durations
  const mediaUnresolved = unresolved.filter(
    (el) => el.tagName === "video" || el.tagName === "audio",
  );

  if (mediaUnresolved.length > 0) {
    const resolutions: ResolvedDuration[] = [];

    for (const el of mediaUnresolved) {
      if (!el.src) continue;
      const src = resolveMediaSrc(el.src, projectDir);
      const fileDuration = await probeMediaDuration(src);
      if (fileDuration <= 0) continue;

      const effectiveDuration = fileDuration - el.mediaStart;
      resolutions.push({
        id: el.id,
        duration: effectiveDuration > 0 ? effectiveDuration : fileDuration,
      });
    }

    if (resolutions.length > 0) {
      html = injectDurations(html, resolutions);
    }
  }

  // Phase 2: Validate pre-resolved media — clamp data-duration to actual source duration
  const preResolved = extractResolvedMedia(html);
  const clampList: ResolvedDuration[] = [];

  for (const el of preResolved) {
    if (!el.src) continue;
    const src = resolveMediaSrc(el.src, projectDir);
    const fileDuration = await probeMediaDuration(src);
    if (fileDuration <= 0) continue;

    const maxDuration = fileDuration - el.mediaStart;
    if (maxDuration > 0 && el.duration > maxDuration) {
      clampList.push({ id: el.id, duration: maxDuration });
    }
  }

  if (clampList.length > 0) {
    html = clampDurations(html, clampList);
  }

  return html;
}
