// What every `hyperframes measure <op>` shares: one JSON object on stdout (summaries, never per-frame arrays;
// pictures as file paths), progress on stderr, and an error that says what to run instead.
import { c } from "../ui/colors.js";
import { failCommand } from "../utils/commandResult.js";
import { normalizeErrorMessage } from "../utils/errorMessage.js";
import { withMeta } from "../utils/updateCheck.js";
import {
  Fix,
  formatJson,
  parseNumbers,
  parseRoi,
  probeVideo,
  type Roi,
  type VideoInfo,
} from "./media.js";

export async function runMeasure(work: () => object | Promise<object>): Promise<void> {
  try {
    console.log(formatJson(withMeta({ ok: true, ...(await work()) })));
  } catch (err) {
    const fix = err instanceof Fix ? err.fix : undefined;
    console.log(
      formatJson(
        withMeta({ ok: false, error: normalizeErrorMessage(err), ...(fix ? { fix } : {}) }),
      ),
    );
    if (process.stdout.isTTY) console.error(`${c.error("✗")} ${normalizeErrorMessage(err)}`);
    failCommand();
  }
}

/** Arguments most ops take. */
export const videoArg = {
  type: "positional",
  description: "The video file",
  required: true,
} as const;
export const roiArg = {
  type: "string",
  description: "Region x,y,w,h in the video's pixels (default: whole frame)",
} as const;
export const outArg = {
  type: "string",
  description: "Folder for pictures (default .hyperframes/measure/<op>)",
} as const;
export const jsonArg = {
  type: "boolean",
  description: "Accepted for symmetry; output is always JSON",
  default: false,
} as const;
/** Where a second video (your render) is measured, when it is measured the same way. */
export const compareWindowArgs = {
  "compare-start": { type: "string", description: "Its window start (default: --start)" },
  "compare-roi": { type: "string", description: "Its region (default: --roi)" },
} as const;

/** The video's probe and its ROI (whole frame by default). */
export function videoAndRoi(video: unknown, roi: unknown): { info: VideoInfo; roi: Roi } {
  const info = probeVideo(String(video));
  return {
    info,
    roi:
      roi === undefined ? [0, 0, info.width, info.height] : parseRoi(roi, info.width, info.height),
  };
}

/** One number from a flag, or `fallback` when it is absent. */
export function num(value: unknown, flag: string, fallback: number): number;
export function num(value: unknown, flag: string): number | undefined;
export function num(value: unknown, flag: string, fallback?: number): number | undefined {
  return value === undefined ? fallback : parseNumbers(value, flag)[0];
}

/** start,end seconds from --start/--end (or --from/--to), clamped to the video. */
export function window(
  info: VideoInfo,
  start: unknown,
  end: unknown,
  flags = ["--start", "--end"],
) {
  const a = num(start, flags[0]!, 0);
  const b = Math.min(info.duration, num(end, flags[1]!, info.duration));
  if (!(b > a))
    throw new Fix(
      `${flags[1]} ${b} is not after ${flags[0]} ${a}`,
      `${flags[0]} 0 ${flags[1]} ${Math.min(6, info.duration)}`,
    );
  return [a, b] as const;
}
