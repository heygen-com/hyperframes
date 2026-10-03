/**
 * ffmetadata chapter files and ffmpeg argv helpers.
 *
 * Chapter mux adds one extra `-i` after the existing video/audio inputs.
 * Provenance stays on `-metadata` flags (not an input), so numbering is
 * "count the `-i` flags already on the argv, then append".
 */

export interface FfmetadataChapter {
  start: number;
  title: string;
}

const CHAPTER_TIMEBASE = "1/1000";

function escapeFfmetadataValue(value: string): string {
  return value.replace(/[\\=;#\n]/g, (ch) => `\\${ch}`);
}

function secondsToMillis(seconds: number): number {
  return Math.max(0, Math.round(seconds * 1000));
}

export function countFfmpegInputFlags(args: readonly string[]): number {
  let count = 0;
  for (const arg of args) {
    if (arg === "-i") count++;
  }
  return count;
}

export function serializeFfmetadataChapters(
  chapters: readonly FfmetadataChapter[],
  durationSeconds: number,
): string {
  const sorted = [...chapters]
    .filter((chapter) => Number.isFinite(chapter.start) && chapter.title.trim().length > 0)
    .sort((a, b) => a.start - b.start);
  const durationMs = secondsToMillis(durationSeconds);
  const lines = [";FFMETADATA1"];
  for (let i = 0; i < sorted.length; i++) {
    const chapter = sorted[i];
    if (!chapter) continue;
    const next = sorted[i + 1];
    const startMs = secondsToMillis(chapter.start);
    const endMs = next ? secondsToMillis(next.start) : durationMs;
    lines.push("[CHAPTER]");
    lines.push(`TIMEBASE=${CHAPTER_TIMEBASE}`);
    lines.push(`START=${startMs}`);
    lines.push(`END=${Math.max(startMs, endMs)}`);
    lines.push(`title=${escapeFfmetadataValue(chapter.title.trim())}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Append `-i <ffmetadata> -map_metadata N` using the next free input index.
 * Skipped for WebM (no chapter track in this pipeline) and when no path is set.
 */
export function appendFfmetadataChapterInput(
  args: string[],
  outputPath: string,
  chaptersFfmetadataPath?: string,
): void {
  if (!chaptersFfmetadataPath) return;
  if (outputPath.toLowerCase().endsWith(".webm")) return;
  const inputIndex = countFfmpegInputFlags(args);
  args.push("-i", chaptersFfmetadataPath, "-map_metadata", String(inputIndex));
}
