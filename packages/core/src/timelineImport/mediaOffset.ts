export interface MediaOffsetInput {
  mediaStart: number;
  fileOrigin: number;
  mediaOrigin: number | null;
  fileDuration: number | undefined;
}

export type MediaOffsetBasis = "file" | "hint" | "relative" | "unfit";

export interface MediaOffset {
  mediaStart: number;
  basis: MediaOffsetBasis;
}

const TOLERANCE = 0.1;
const ceil6 = (n: number) => Math.ceil(n * 1e6 - 1e-4) / 1e6;

/**
 * Turns a position on the source's clock into seconds into the file: the file's own timecode, then
 * the hint, then plain seconds, whichever first lands the clip's start inside the file. Rounded up
 * because the renderer floors to a source frame.
 */
export function resolveMediaStart(input: MediaOffsetInput): MediaOffset {
  const { mediaStart, fileOrigin, mediaOrigin, fileDuration } = input;
  const fits = (seconds: number) =>
    seconds >= -TOLERANCE && (fileDuration === undefined || seconds < fileDuration + TOLERANCE);
  const place = (origin: number) => Math.max(0, ceil6(mediaStart - origin));

  const candidates: Array<{ origin: number; basis: Exclude<MediaOffsetBasis, "unfit"> }> = [
    { origin: fileOrigin, basis: "file" },
    ...(mediaOrigin === null ? [] : [{ origin: mediaOrigin, basis: "hint" as const }]),
    { origin: 0, basis: "relative" },
  ];
  const seen = new Set<number>();
  for (const { origin, basis } of candidates) {
    if (seen.has(origin)) continue;
    seen.add(origin);
    if (fits(mediaStart - origin)) return { mediaStart: place(origin), basis };
  }
  return { mediaStart: place(fileOrigin), basis: "unfit" };
}
