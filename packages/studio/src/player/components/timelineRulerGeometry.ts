import { formatTime } from "../lib/time";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";

// fallow-ignore-next-line complexity
export function getTimelineMajorTickInterval(
  duration: number,
  pixelsPerSecond?: number,
  frameRate?: number,
): number {
  const zoomIntervals = [
    0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
  ];
  let interval: number;
  if (Number.isFinite(pixelsPerSecond) && (pixelsPerSecond ?? 0) > 0) {
    const targetMajorPx = 88;
    interval =
      zoomIntervals.find((candidate) => candidate * (pixelsPerSecond ?? 0) >= targetMajorPx) ??
      3600;
  } else {
    const durationIntervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const target = duration / 6;
    interval = durationIntervals.find((candidate) => candidate >= target) ?? 60;
  }
  if (Number.isFinite(frameRate) && (frameRate ?? 0) > 0) {
    const fps = frameRate ?? 0;
    return Math.max(1, Math.ceil(interval * fps - 1e-6)) / fps;
  }
  return interval;
}

// fallow-ignore-next-line complexity
function getMinorSubdivisions(
  majorInterval: number,
  pixelsPerSecond?: number,
  frameRate?: number,
): number {
  const pps = Number.isFinite(pixelsPerSecond) ? (pixelsPerSecond ?? 0) : 0;
  if (pps <= 0) return 4;
  const fps = Number.isFinite(frameRate) ? (frameRate ?? 0) : 0;
  const majorFrames = fps > 0 ? Math.round(majorInterval * fps) : 0;
  const candidates = fps > 0 ? [4, 5, 3, 2] : [4, 2];
  for (const parts of candidates) {
    if (fps > 0 && majorFrames % parts !== 0) continue;
    if ((majorInterval / parts) * pps >= 8) return parts;
  }
  return 0;
}

function roundTickValue(time: number): number {
  return Math.round(time * 1e6) / 1e6;
}

function isSupportedTickDuration(duration: number): boolean {
  return duration > 0 && Number.isFinite(duration) && duration <= 14400;
}

function getTickRange(duration: number, range?: TimelineTimeRange): TimelineTimeRange {
  return {
    start: Math.max(0, range?.start ?? 0),
    end: Math.min(duration, range?.end ?? duration),
  };
}

function appendMinorTicks(
  minor: number[],
  majorTime: number,
  minorInterval: number,
  subdivisions: number,
  range: TimelineTimeRange,
  maxTicks: number,
  majorCount: number,
): void {
  for (let part = 1; part < subdivisions && majorCount + minor.length < maxTicks; part++) {
    const time = majorTime + part * minorInterval;
    if (time >= range.start - 0.001 && time <= range.end + 0.001) {
      minor.push(roundTickValue(time));
    }
  }
}

export function generateTicks(
  duration: number,
  pixelsPerSecond?: number,
  frameRate?: number,
  range?: TimelineTimeRange,
): { major: number[]; minor: number[] } {
  if (!isSupportedTickDuration(duration)) return { major: [], minor: [] };
  const majorInterval = getTimelineMajorTickInterval(duration, pixelsPerSecond, frameRate);
  const subdivisions = getMinorSubdivisions(majorInterval, pixelsPerSecond, frameRate);
  const minorInterval = subdivisions > 0 ? majorInterval / subdivisions : 0;
  const major: number[] = [];
  const minor: number[] = [];
  const maxTicks = 2000;
  const tickRange = getTickRange(duration, range);
  const firstMajorIndex = Math.max(0, Math.floor(tickRange.start / majorInterval));
  for (let index = firstMajorIndex; major.length < maxTicks; index++) {
    const time = index * majorInterval;
    if (time > tickRange.end + 0.001) break;
    if (time >= tickRange.start - 0.001) major.push(roundTickValue(time));
    appendMinorTicks(minor, time, minorInterval, subdivisions, tickRange, maxTicks, major.length);
  }
  return { major, minor };
}

export function formatTimelineTickLabel(
  time: number,
  duration: number,
  majorInterval: number,
): string {
  if (!Number.isFinite(time)) return "00:00";
  const safeTime = Math.max(0, time);
  if (majorInterval < 0.1) {
    const totalHundredths = Math.round(safeTime * 100);
    const wholeSeconds = Math.floor(totalHundredths / 100);
    const hundredth = totalHundredths % 100;
    return `${formatTime(wholeSeconds)}.${hundredth.toString().padStart(2, "0")}`;
  }
  if (majorInterval < 1) {
    const totalTenths = Math.round(safeTime * 10);
    const wholeSeconds = Math.floor(totalTenths / 10);
    const tenth = totalTenths % 10;
    return `${formatTime(wholeSeconds)}.${tenth}`;
  }
  if (duration >= 3600 || safeTime >= 3600) {
    const totalSeconds = Math.floor(safeTime);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return formatTime(safeTime);
}
