/**
 * What to do when the render stopped on a video source it could not use. The generic hint is
 * "Try --docker", which cannot help: a container reads the same file.
 */
const SOURCE_HINTS: Readonly<Record<string, string>> = {
  invalid_media:
    "FFmpeg could not read the file as a video. Check it with `ffprobe <file>`: a file that is still being written, or was cut short, fails this way. Render again once it is complete.",
  source_missing:
    "The video file is not there. Check the `src` of the <video> against the project folder.",
  download_not_found:
    "The video URL answered 404 or 410. Check the `src` of the <video>, or download the file into the project.",
};

function failureKinds(error: unknown): string[] | null {
  let seen: unknown = error;
  for (let depth = 0; depth < 5 && seen instanceof Error; depth++) {
    const { code, failures } = seen as { code?: unknown; failures?: unknown };
    if (code === "VIDEO_SOURCE_UNRENDERABLE" && Array.isArray(failures)) {
      return failures.map((failure: { kind?: unknown }) => String(failure?.kind));
    }
    seen = seen.cause;
  }
  return null;
}

/** The hint for a source failure, or null when the failure is not one this can explain. */
export function sourceFailureHint(error: unknown): string | null {
  const kinds = failureKinds(error);
  if (!kinds || kinds.length === 0) return null;
  const hints = [...new Set(kinds.map((kind) => SOURCE_HINTS[kind]))];
  if (hints.some((hint) => hint === undefined)) return null;
  return hints.join(" ");
}
