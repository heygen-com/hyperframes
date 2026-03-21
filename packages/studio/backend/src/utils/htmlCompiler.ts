import { resolve } from "path";
import { compileTimingAttrs, injectDurations, type ResolvedDuration } from "@hyperframes/core";
import { probeMediaDuration } from "./ffprobe";

/**
 * Compile HTML with full duration resolution.
 *
 * 1. Static pass: compileTimingAttrs() adds data-end where data-duration exists
 * 2. For unresolved video/audio (no data-duration): probe via ffprobe, inject durations
 */
export async function compileHtml(rawHtml: string, projectDir: string): Promise<string> {
  const { html: staticCompiled, unresolved } = compileTimingAttrs(rawHtml);

  const mediaUnresolved = unresolved.filter(
    (el) => el.tagName === "video" || el.tagName === "audio"
  );

  if (mediaUnresolved.length === 0) return staticCompiled;

  const resolutions: ResolvedDuration[] = [];

  for (const el of mediaUnresolved) {
    if (!el.src) continue;

    const src = el.src.startsWith("http://") || el.src.startsWith("https://")
      ? el.src
      : resolve(projectDir, el.src);

    const fileDuration = await probeMediaDuration(src);
    if (fileDuration <= 0) continue;

    const effectiveDuration = fileDuration - el.mediaStart;
    resolutions.push({
      id: el.id,
      duration: effectiveDuration > 0 ? effectiveDuration : fileDuration,
    });
  }

  if (resolutions.length === 0) return staticCompiled;

  return injectDurations(staticCompiled, resolutions);
}
