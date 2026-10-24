import { parseHTML } from "linkedom";
import { createRuntimeStartTimeResolver } from "@hyperframes/core";
export type SnapshotRange = [number, number];
export function parseSnapshotRange(value: string): SnapshotRange {
  const parts = value.split(/[,:]/);
  const range = parts.map((part) => (part.trim() === "" ? NaN : Number(part)));
  if (
    parts.length !== 2 ||
    !range.every(Number.isFinite) ||
    range[0]! < 0 ||
    range[1]! <= range[0]!
  )
    throw new Error("--range must be START,END in seconds, with 0 <= START < END");
  return [range[0]!, range[1]!];
}
export function parseSnapshotAt(value: string): number[] {
  const times = value.split(",").map((part) => (part.trim() === "" ? NaN : Number(part)));
  if (!times.every((time) => Number.isFinite(time) && time >= 0))
    throw new Error("--at must be comma-separated times in seconds, each 0 or more");
  return times;
}
export function sampleSnapshotRange(
  [start, end]: SnapshotRange,
  frames: number,
  duration: number,
  exclusiveEnd = false,
): number[] {
  if (!Number.isInteger(frames) || frames < 1)
    throw new Error("--frames must be a positive integer");
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > duration
  )
    throw new Error(`Snapshot range must satisfy 0 <= START < END <= ${duration}s`);
  if (frames === 1) return [(start + end) / 2];
  // Clip ends are exclusive; keep the last sample inside the visible interval.
  const last =
    exclusiveEnd || end === duration ? end - Math.min(0.001, (end - start) / (frames * 2)) : end;
  return Array.from({ length: frames }, (_, i) => start + ((last - start) * i) / (frames - 1));
}
export function snapshotStartResolver(document: Document, durations: Record<string, number>) {
  return createRuntimeStartTimeResolver({
    documentRef: document,
    timelineRegistry: Object.fromEntries(
      Object.entries(durations).map(([key, value]) => [key, { duration: () => value }]),
    ),
    includeAuthoredTimingAttrs: true,
  });
}
export function resolveSnapshotCompositionRange(
  html: string,
  durations: Record<string, number>,
  id: string,
  duration: number,
): SnapshotRange {
  const { document } = parseHTML(html);
  const matches = Array.from(document.querySelectorAll("[data-composition-id]")).filter(
    (el) => el.getAttribute("data-composition-id") === id,
  );
  if (matches.length !== 1)
    throw new Error(
      `Composition ID ${JSON.stringify(id)} matched ${matches.length} elements; expected exactly one`,
    );
  const resolver = snapshotStartResolver(document as unknown as Document, durations);
  let start = 0,
    end = duration;
  for (let el: Element | null = matches[0] as unknown as Element; el; el = el.parentElement) {
    if (!el.hasAttribute("data-composition-id") && !el.hasAttribute("data-start")) continue;
    const localStart = resolver.resolveStartForElement(el, 0);
    const length = resolver.resolveDurationForElement(el);
    if (!Number.isFinite(localStart))
      throw new Error(`Cannot resolve start of composition ${JSON.stringify(id)}`);
    start = Math.max(start, localStart);
    if (length != null) end = Math.min(end, localStart + length);
  }
  if (end <= start)
    throw new Error(`Composition ${JSON.stringify(id)} has no visible time interval`);
  return [start, end];
}
