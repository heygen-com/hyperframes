import { execFileSync } from "node:child_process";
import { findFFprobe } from "../browser/ffmpeg.js";

/** What a media file says about where its own clock starts. */
export interface OriginProbe {
  /** The start timecode a video carries, in seconds; null when it has none. */
  timecode: number | null;
  /** A WAV's BWF `time_reference` (samples since midnight) as seconds; null when it has none. */
  timeReference: number | null;
  duration: number | undefined;
}

/**
 * `HH:MM:SS:FF`, or `HH:MM:SS;FF` for drop-frame, as seconds on the file's clock. The frame count
 * is divided by the real rate (3603.6 s for an hour at 29.97), and drop-frame's skipped labels
 * are taken back out.
 */
export function timecodeSeconds(timecode: string, fps: number): number | null {
  const match = /^(\d+):(\d{2}):(\d{2})([:;.,])(\d+)$/.exec(timecode.trim());
  if (!match || !(fps > 0)) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[5]);
  const dropFrame = match[4] === ";" || match[4] === ",";
  const nominal = Math.round(fps);
  let count = (hours * 3600 + minutes * 60 + seconds) * nominal + frames;
  if (dropFrame && (nominal === 30 || nominal === 60)) {
    const dropped = nominal === 30 ? 2 : 4;
    const totalMinutes = hours * 60 + minutes;
    count -= dropped * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return count / fps;
}

export function timeReferenceSeconds(samples: string, sampleRate: number): number | null {
  const count = Number(samples);
  return Number.isFinite(count) && count >= 0 && sampleRate > 0 ? count / sampleRate : null;
}

const rational = (text: string | undefined): number | null => {
  const [num, den] = (text ?? "").split("/").map(Number);
  return num !== undefined && den !== undefined && den > 0 && num > 0 ? num / den : null;
};

interface FfprobeStream {
  codec_type?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  tags?: Record<string, string>;
}

const tag = (tags: Record<string, string> | undefined, name: string): string | undefined =>
  Object.entries(tags ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

/** Reads the start timecode, BWF time reference and length from ffprobe's JSON. */
export function originFromProbe(json: {
  streams?: FfprobeStream[];
  format?: { duration?: string; tags?: Record<string, string> };
}): OriginProbe {
  const streams = json.streams ?? [];
  const tags = json.format?.tags;
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  const holder = streams.find((s) => tag(s.tags, "timecode") !== undefined);
  const timecodeText = tag(tags, "timecode") ?? tag(holder?.tags, "timecode");
  // The rate a timecode counts at is the video's; a timecode data track can report none of its own.
  const fps =
    rational(video?.r_frame_rate) ??
    rational(video?.avg_frame_rate) ??
    rational(holder?.r_frame_rate) ??
    rational(holder?.avg_frame_rate);
  const timecode =
    timecodeText !== undefined && fps !== null ? timecodeSeconds(timecodeText, fps) : null;

  const reference = tag(tags, "time_reference");
  const timeReference =
    reference !== undefined && audio?.sample_rate !== undefined
      ? timeReferenceSeconds(reference, Number(audio.sample_rate))
      : null;

  const length = Number(json.format?.duration);
  return { timecode, timeReference, duration: Number.isFinite(length) ? length : undefined };
}

/** Asks ffprobe about the file; undefined when ffprobe is missing or cannot read it. */
export function probeOrigin(file: string): OriginProbe | undefined {
  const ffprobe = findFFprobe();
  if (!ffprobe) return undefined;
  try {
    const raw = execFileSync(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "--", file],
      { encoding: "utf-8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return originFromProbe(JSON.parse(raw));
  } catch {
    return undefined;
  }
}
