// Decode with ffmpeg into raw arrays, so measuring and comparing need nothing but node and ffmpeg.
// Ported from the Studio's viral-clone media.mjs and tool.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findFFmpeg, findFFprobe, getFFmpegInstallHint } from "../browser/ffmpeg.js";

const MAX_BUFFER = 1 << 30;
/** ffmpeg's own flags on every run. Inline before a spread, the ffprobe `--` contract test reads them as a probe wrapper. */
const FFMPEG_QUIET = ["-nostdin", "-v", "error"];

/** An error whose message says what to run instead; commands print `fix` as its own line. */
export class Fix extends Error {
  constructor(
    problem: string,
    readonly fix: string,
  ) {
    super(problem);
    this.name = "Fix";
  }
}

export function ffmpegBin(): string {
  const bin = findFFmpeg();
  if (!bin) throw new Fix("ffmpeg is not installed", getFFmpegInstallHint());
  return bin;
}

function ffprobeBin(): string {
  const bin = findFFprobe();
  if (!bin) throw new Fix("ffprobe is not installed", getFFmpegInstallHint());
  return bin;
}

/** Runs ffmpeg and returns its stdout; `input` is piped to stdin. */
export function runFfmpeg(args: string[], input?: Buffer, cwd?: string): Buffer {
  return execFileSync(ffmpegBin(), [...FFMPEG_QUIET, ...args], {
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    ...(input ? { input } : {}),
    ...(cwd ? { cwd } : {}),
  });
}

export interface VideoInfo {
  path: string;
  width: number;
  height: number;
  fps: number;
  /** The frame rate as ffmpeg writes it, e.g. 30000/1001. */
  fpsText: string;
  duration: number;
  /** The picture's length: the container's can run on with a longer sound track. */
  pictureDuration: number;
  frames: number;
  audio: boolean;
  /** Seconds the sound starts after the picture (0 when it starts with it or there is none). */
  audioStart: number;
  /** Frames over seconds, which a variable-rate video's nominal rate does not tell. */
  avgFps: number;
  /** The container's frame rate and the stream's average differ: frames are not evenly spaced. */
  vfr: boolean;
  hdr: boolean;
  codec: string;
}

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  start_time?: string;
  color_transfer?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

const rate = (text: string | undefined): number => {
  const [a, b] = String(text ?? "0/1")
    .split("/")
    .map(Number);
  return b ? (a ?? 0) / b : (a ?? 0);
};

/** Size (as displayed, rotation applied), clock and sound of a video. */
// fallow-ignore-next-line complexity
export function probeVideo(path: string): VideoInfo {
  if (!existsSync(path))
    throw new Fix(`no file at ${path}`, "pass the video's path from the project folder");
  let json: { streams?: ProbeStream[]; format?: { duration?: string } };
  try {
    json = JSON.parse(
      execFileSync(
        ffprobeBin(),
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", "--", path],
        { maxBuffer: MAX_BUFFER, windowsHide: true },
      ).toString(),
    );
  } catch {
    throw new Fix(`ffprobe cannot read ${path}`, "pass a video file (mp4, mov, webm)");
  }
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  if (!video) throw new Fix(`${path} has no video stream`, "pass a video file, not audio");
  const rotation = Math.abs(
    Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0) ||
      Number(video.tags?.rotate ?? 0),
  );
  const turned = rotation % 180 === 90;
  const fpsText = video.r_frame_rate && video.r_frame_rate !== "0/0" ? video.r_frame_rate : "30/1";
  const fps = rate(fpsText);
  const avg = rate(video.avg_frame_rate);
  const duration = Number(json.format?.duration ?? video.duration ?? 0);
  const counted = Number(video.nb_frames ?? 0);
  const sound = streams.find((s) => s.codec_type === "audio");
  const frames = counted > 0 ? counted : Math.round(duration * fps);
  return {
    path,
    width: (turned ? video.height : video.width) ?? 0,
    height: (turned ? video.width : video.height) ?? 0,
    fps,
    fpsText: fpsText.endsWith("/1") ? fpsText.slice(0, -2) : fpsText,
    duration,
    pictureDuration: Number(video.duration ?? 0) || frames / (avg || fps),
    frames,
    audio: Boolean(sound),
    audioStart: Math.max(0, Number(sound?.start_time ?? 0) - Number(video.start_time ?? 0) || 0),
    avgFps: avg || fps,
    vfr: avg > 0 && Math.abs(avg - fps) / fps > 0.01,
    hdr: /smpte2084|arib-std-b67/.test(video.color_transfer ?? ""),
    codec: video.codec_name ?? "",
  };
}

export type Roi = [x: number, y: number, w: number, h: number];

export interface ReadOptions {
  start?: number;
  /** Seconds to read; omit for the rest of the file. */
  seconds?: number;
  roi?: Roi;
  /** Output width (height follows the ROI's aspect, even); 0 or omitted keeps the ROI's size. */
  width?: number;
  gray?: boolean;
  /** Resample to this rate; 0 or omitted reads every frame. */
  fps?: number;
  /** Stop after this many frames. */
  limit?: number;
}

export interface Frames {
  frames: Uint8Array[];
  w: number;
  h: number;
}

/**
 * Frames from anywhere ffmpeg reads: a window of a video file, or a numbered picture sequence. `filters` run
 * before any crop or scale, so a clip can pick frames (select, fps) without changing their size.
 */
export interface Clip {
  input: string[];
  filters: string[];
  width: number;
  height: number;
  fps: number;
}

/** A window of a video file as a clip; `info` saves a probe when the caller has one. */
export function videoClip(
  path: string,
  start = 0,
  seconds?: number,
  info = probeVideo(path),
): Clip {
  return {
    input: [
      ...(start > 0 ? ["-ss", String(start)] : []),
      "-i",
      path,
      ...(seconds !== undefined ? ["-t", String(seconds)] : []),
    ],
    filters: [],
    width: info.width,
    height: info.height,
    fps: info.fps,
  };
}

/** A clip's frames of one ROI as raw RGB (or grey) bytes. */
export function readClip(clip: Clip, opts: Omit<ReadOptions, "start" | "seconds"> = {}): Frames {
  const { roi, width = 0, gray = false, fps = 0, limit } = opts;
  const filters = [...clip.filters];
  if (fps) filters.push(`fps=${fps}`);
  let [w, h] = [clip.width, clip.height];
  if (roi) {
    filters.push(`crop=${roi[2]}:${roi[3]}:${roi[0]}:${roi[1]}`);
    [w, h] = [roi[2], roi[3]];
  }
  if (width && width !== w) {
    const outH = Math.max(2, Math.round((h * width) / w / 2) * 2);
    filters.push(`scale=${width}:${outH}`);
    [w, h] = [width, outH];
  }
  return decode(clip.input, filters, w, h, gray, limit);
}

/** The frame shown at `t`, picked by its index: seeking by time can land a frame early or late. */
export function readFrameAt(
  info: VideoInfo,
  t: number,
  opts: Omit<ReadOptions, "start" | "seconds" | "fps"> = {},
): Frames {
  const k = Math.min(info.frames - 1, frameAt(t, info.fps));
  return readClip(
    { ...videoClip(info.path, 0, undefined, info), filters: [`select=eq(n\\,${k})`] },
    { ...opts, limit: 1 },
  );
}

/** Frames of one ROI of a video file as raw RGB (or grey) bytes. */
export function readFrames(path: string, opts: ReadOptions = {}): Frames {
  return readClip(videoClip(path, opts.start, opts.seconds), opts);
}

/** Every frame (or the first `limit`) ffmpeg's `input` arguments yield after `filters`, which must end at `w`x`h`. */
export function decode(
  input: string[],
  filters: string[],
  w: number,
  h: number,
  gray = false,
  limit?: number,
): Frames {
  const raw = runFfmpeg([
    ...input,
    "-an",
    "-vf",
    [...filters, `format=${gray ? "gray" : "rgb24"}`].join(","),
    ...(limit ? ["-frames:v", String(limit)] : []),
    "-f",
    "rawvideo",
    "-",
  ]);
  const size = w * h * (gray ? 1 : 3);
  const frames: Uint8Array[] = [];
  for (let i = 0; i + size <= raw.length; i += size) frames.push(raw.subarray(i, i + size));
  return { frames, w, h };
}

/** BT.601 luma of RGB bytes. */
export function grey(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < out.length; i++)
    out[i] = (77 * rgb[3 * i]! + 150 * rgb[3 * i + 1]! + 29 * rgb[3 * i + 2]!) >> 8;
  return out;
}

/** Mean absolute difference of two equal-length byte arrays. */
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / (a.length || 1);
}

/** Writes raw RGB (or grey) bytes as an image; the extension picks the format. */
export function writeImage(path: string, px: Uint8Array, w: number, h: number, gray = false) {
  const header = Buffer.from(`${gray ? "P5" : "P6"}\n${w} ${h}\n255\n`);
  runFfmpeg(
    ["-y", "-f", gray ? "pgm_pipe" : "ppm_pipe", "-i", "-", "-frames:v", "1", path],
    Buffer.concat([header, Buffer.from(px.buffer, px.byteOffset, px.byteLength)]),
  );
  return path;
}

export const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Yours over the reference; two values under `floor` are both nothing, and nothing matches nothing. */
export const ratioOf = (yours: number, ref: number, floor: number): number =>
  yours < floor && ref < floor ? 1 : yours / (ref || 1e-9);

/** "1,2.5,4" as numbers. */
export function parseNumbers(text: unknown, flag: string): number[] {
  const out = String(text ?? "")
    .split(",")
    .filter((s) => s.trim() !== "")
    .map(Number);
  if (!out.length || out.some((n) => !Number.isFinite(n)))
    throw new Fix(
      `${flag} must be numbers separated by commas, got "${String(text)}"`,
      `${flag} 1.2,3.4`,
    );
  return out;
}

/** "start,end" seconds with 0 <= start < end. */
export function parseRange(text: unknown, flag = "--range"): [number, number] {
  const v = parseNumbers(text, flag);
  if (v.length !== 2 || v[0]! < 0 || v[1]! <= v[0]!)
    throw new Fix(
      `${flag} must be start,end seconds with start < end, got "${String(text)}"`,
      `${flag} 2.1,4.5`,
    );
  return [v[0]!, v[1]!];
}

/** "x,y,w,h" in pixels, inside a `width`x`height` frame when one is given. */
export function parseRoi(text: unknown, width?: number, height?: number): Roi {
  const v = parseNumbers(text, "--roi").map(Math.round);
  if (v.length !== 4 || v[2]! <= 0 || v[3]! <= 0)
    throw new Fix(
      `--roi must be x,y,w,h with a positive size, got "${String(text)}"`,
      "--roi 100,200,400,300",
    );
  const roi: Roi = [v[0]!, v[1]!, v[2]!, v[3]!];
  if (
    width &&
    height &&
    (roi[0] < 0 || roi[1] < 0 || roi[0] + roi[2] > width || roi[1] + roi[3] > height)
  )
    throw new Fix(
      `--roi ${roi.join(",")} runs past the ${width}x${height} frame`,
      `keep it inside 0,0,${width},${height}`,
    );
  return roi;
}

/** The folder a tool writes its pictures to, made on demand: --out, or .hyperframes/<tool> in the current folder. */
export function outDir(out: unknown, tool: string): string {
  const dir = typeof out === "string" && out ? resolve(out) : resolve(join(".hyperframes", tool));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The frame shown at time `t`, allowing for times printed to the millisecond (38/24 s printed as 1.583). */
export const frameAt = (t: number, fps: number) =>
  Math.max(0, Math.floor((t + 0.0005) * fps + 1e-6));

/** JSON with each innermost array or object on one line: readable, and a fraction of the tokens. */
export const formatJson = (value: unknown) =>
  JSON.stringify(value, null, 1).replace(/[[{][^[\]{}]*[\]}]/g, (m) => m.replace(/\n\s*/g, " "));

/** Pearson correlation of two series over their common length; null when either one is flat. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let [num, da, db] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}
