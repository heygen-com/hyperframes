import { parseHTML } from "linkedom";
import { topLevelElements, trackKindOf } from "@hyperframes/parsers";
import { toDomNode } from "../timeline/domStructure.js";
import {
  resolveSnapshotCompositionRange,
  snapshotStartResolver,
  type SnapshotRange,
} from "./snapshotSampling.js";

/** A beat's frame lands this long after its start, once the entrance has settled. */
const REVIEW_SETTLE_SEC = 0.3;
const REVIEW_MID_GAP_SEC = 0.5;
/** Seam strip offsets around each cut. */
export const REVIEW_SEAM_OFFSETS = [-0.2, -0.1, 0, 0.1, 0.2] as const;
/** Phone sheet tile width: the frame as wide as a phone held upright. */
export const REVIEW_PHONE_WIDTH = 360;
/** Starts and ends closer than this are one boundary. */
const SAME_TIME_SEC = 0.05;
/** Without two scene starts there is nothing to cut between, so the beats are spread evenly. */
const EVEN_BEATS = 5;

export interface ReviewScene {
  id: string;
  start: number;
  end: number;
}

export interface ReviewBeat {
  time: number;
  /** Scene id, `beat:<data-beat>` for an authored beat, or `t=<time>` when sampled evenly. */
  label: string;
}

export interface ReviewSeam {
  time: number;
  from: string | null;
  to: string | null;
  times: number[];
}

export interface ReviewPlan {
  window: SnapshotRange;
  scenes: ReviewScene[];
  beats: ReviewBeat[];
  seams: ReviewSeam[];
  notes: string[];
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function sceneId(el: Element, index: number): string {
  return (
    el.id ||
    el.getAttribute("data-composition-id") ||
    el.getAttribute("data-layout-name") ||
    `${el.tagName.toLowerCase()}-${index + 1}`
  );
}

/**
 * The review's scenes and authored beats, read like `timeline` reads rows: the composition's
 * top-level timed elements and sub-composition hosts (captions and audio tracks excluded), timed by
 * the runtime's own start resolver over the live page's markup. `durations` are the registered
 * GSAP timeline lengths, which time a host that declares no data-duration.
 */
export function resolveReviewTimeline(
  html: string,
  durations: Record<string, number>,
  duration: number,
  compositionId?: string,
): { window: SnapshotRange; scenes: ReviewScene[]; beats: ReviewBeat[]; notes: string[] } {
  const bounds: SnapshotRange = compositionId
    ? resolveSnapshotCompositionRange(html, durations, compositionId, duration)
    : [0, duration];
  const { document } = parseHTML(html);
  const target = compositionId
    ? Array.from(document.querySelectorAll("[data-composition-id]")).find(
        (el) => el.getAttribute("data-composition-id") === compositionId,
      )
    : document.querySelector("[data-composition-id]");
  if (!target) {
    return { window: bounds, scenes: [], beats: [], notes: ["No composition root found."] };
  }
  const resolver = snapshotStartResolver(document as unknown as Document, durations);
  const span = (el: Element): [number, number] | null => {
    // The fallback reaches every untimed ancestor, the root included, so it must be the root's 0.
    const start = resolver.resolveStartForElement(el, 0);
    if (!Number.isFinite(start)) return null;
    const length = resolver.resolveDurationForElement(el);
    const from = Math.max(bounds[0], start);
    const to = Math.min(bounds[1], length != null ? start + length : bounds[1]);
    return to > from ? [roundMs(from), roundMs(to)] : null;
  };
  const scenes: ReviewScene[] = [];
  const rows = topLevelElements(toDomNode(target as unknown as Element)).filter((node) => {
    const kind = trackKindOf(node).kind;
    return kind === "video" || kind === "graphics";
  });
  rows.forEach((node, index) => {
    const interval = span(node.el);
    if (interval)
      scenes.push({ id: sceneId(node.el, index), start: interval[0], end: interval[1] });
  });
  const beats: ReviewBeat[] = [];
  const notes: string[] = [];
  for (const el of Array.from((target as unknown as Element).querySelectorAll("[data-beat]"))) {
    const name = el.getAttribute("data-beat")?.trim() || sceneId(el, beats.length);
    const timed = el.hasAttribute("data-start") || el.hasAttribute("data-composition-id");
    const interval = timed ? span(el) : null;
    if (!interval) {
      notes.push(`data-beat="${name}" was skipped: give it a data-start so the beat has a time.`);
      continue;
    }
    beats.push({ time: settledTime(interval[0], interval[1]), label: `beat:${name}` });
  }
  scenes.sort((a, b) => a.start - b.start || a.end - b.end);
  return { window: bounds, scenes, beats, notes };
}

/** Just after a scene starts, and its middle once that is far enough on to show what the scene builds. */
function sceneBeats(scene: ReviewScene): ReviewBeat[] {
  const settled = settledTime(scene.start, scene.end);
  const middle = roundMs((scene.start + scene.end) / 2);
  const beats = [{ time: settled, label: scene.id }];
  return middle - settled >= REVIEW_MID_GAP_SEC
    ? [...beats, { time: middle, label: `${scene.id} mid` }]
    : beats;
}

/** start + 0.3 s, or the middle of a span too short for that. */
function settledTime(start: number, end: number): number {
  return roundMs(Math.min(start + REVIEW_SETTLE_SEC, (start + end) / 2));
}

/** Beats, seams and their frame times. `lastFrame` is the latest seek that still shows the film. */
export function planReview(
  timeline: { window: SnapshotRange; scenes: ReviewScene[]; beats: ReviewBeat[]; notes: string[] },
  lastFrame: number,
): ReviewPlan {
  const { window: bounds, scenes } = timeline;
  const notes = [...timeline.notes];
  const clamp = (time: number) => roundMs(Math.min(Math.max(time, bounds[0]), lastFrame));
  const distinctStarts = mergeBeats(
    scenes.map((scene) => ({ time: scene.start, label: scene.id })),
  );
  const beats = mergeBeats([
    ...(distinctStarts.length >= 2 ? scenes.flatMap(sceneBeats) : evenBeats(bounds, notes)),
    ...timeline.beats,
  ]).map((beat) => ({ ...beat, time: clamp(beat.time) }));
  const seams = seamTimes(scenes, bounds).map((time) => ({
    time,
    ...seamSides(scenes, time),
    times: REVIEW_SEAM_OFFSETS.map((offset) => clamp(time + offset)),
  }));
  return { window: bounds, scenes, beats, seams, notes };
}

function evenBeats(bounds: SnapshotRange, notes: string[]): ReviewBeat[] {
  notes.push(
    `Fewer than two scene starts; ${EVEN_BEATS} beats are spread evenly instead. Time scenes as sub-composition hosts or clips to review each one.`,
  );
  const [start, end] = bounds;
  return Array.from({ length: EVEN_BEATS }, (_, index) => {
    const time = roundMs(start + ((index + 0.5) / EVEN_BEATS) * (end - start));
    return { time, label: `t=${time}` };
  });
}

function mergeBeats(beats: ReviewBeat[]): ReviewBeat[] {
  const merged: ReviewBeat[] = [];
  for (const beat of [...beats].sort((a, b) => a.time - b.time)) {
    const same = merged.find((entry) => Math.abs(entry.time - beat.time) < SAME_TIME_SEC);
    if (same) same.label = `${same.label} + ${beat.label}`;
    else merged.push({ ...beat });
  }
  return merged;
}

/** Every scene start after the window opens, and every scene end no other scene starts at. */
export function seamTimes(scenes: ReviewScene[], bounds: SnapshotRange): number[] {
  const inside = (time: number) =>
    time > bounds[0] + SAME_TIME_SEC && time < bounds[1] - SAME_TIME_SEC;
  const starts = scenes.map((scene) => scene.start).filter(inside);
  const ends = scenes
    .map((scene) => scene.end)
    .filter(inside)
    .filter((end) => !starts.some((start) => Math.abs(start - end) < SAME_TIME_SEC));
  const seams: number[] = [];
  for (const time of [...starts, ...ends].sort((a, b) => a - b)) {
    if (!seams.some((seam) => Math.abs(seam - time) < SAME_TIME_SEC)) seams.push(time);
  }
  return seams;
}

function seamSides(
  scenes: ReviewScene[],
  time: number,
): { from: string | null; to: string | null } {
  const before = scenes
    .filter((scene) => scene.start < time - SAME_TIME_SEC && scene.end >= time - SAME_TIME_SEC)
    .sort((a, b) => b.start - a.start)[0];
  const after = scenes
    .filter((scene) => Math.abs(scene.start - time) < SAME_TIME_SEC)
    .sort((a, b) => a.end - b.end)[0];
  const next = after ?? scenes.find((scene) => scene.start > time);
  return { from: before?.id ?? null, to: next?.id ?? null };
}

export interface ReviewFrame {
  role: "beat" | "seam";
  /** 1-based beat or seam number. */
  index: number;
  time: number;
  label: string;
  file: string;
}

function pad(index: number): string {
  return String(index).padStart(2, "0");
}

function stamp(time: number): string {
  return `${Number(time.toFixed(3))}s`;
}

const SEAM_TILE_LABELS = ["cut -0.2", "-0.1", "cut", "+0.1", "+0.2"] as const;

/** Every still a review captures, in capture order, with its file name. */
export function reviewFrames(plan: ReviewPlan): ReviewFrame[] {
  const beats = plan.beats.map((beat, index) => ({
    role: "beat" as const,
    index: index + 1,
    time: beat.time,
    label: beat.label,
    file: `beat-${pad(index + 1)}-at-${stamp(beat.time)}.png`,
  }));
  const seams = plan.seams.flatMap((seam, index) =>
    seam.times.map((time, slot) => ({
      role: "seam" as const,
      index: index + 1,
      time,
      label:
        slot === 2
          ? `cut ${seam.from ?? "start"} -> ${seam.to ?? "end"}`
          : (SEAM_TILE_LABELS[slot] ?? ""),
      file: `seam-${pad(index + 1)}-${slot + 1}-at-${stamp(time)}.png`,
    })),
  );
  return [...beats, ...seams];
}

export interface ReviewSheets {
  beats: string[];
  seams: string[];
  phone: string[];
}

const BEAT_SHEET_PAGE = 16;

/** The beat sheet, one strip per seam, and the beat frames again at phone width. */
export async function writeReviewSheets(
  dir: string,
  frames: ReviewFrame[],
  written: (frame: ReviewFrame) => string | null,
): Promise<ReviewSheets> {
  const { createContactSheet } = await import("../capture/contactSheet.js");
  const { join } = await import("node:path");
  const captured = frames.flatMap((frame) => {
    const path = written(frame);
    return path ? [{ frame, path }] : [];
  });
  const beats = captured.filter((entry) => entry.frame.role === "beat");
  const beatLabel = ({ frame }: (typeof captured)[number]) => `${stamp(frame.time)} ${frame.label}`;
  const pages = async (name: string, cellWidth: number, colsFor: (count: number) => number) => {
    const sheets: string[] = [];
    for (let start = 0; start < beats.length; start += BEAT_SHEET_PAGE) {
      const page = beats.slice(start, start + BEAT_SHEET_PAGE);
      const suffix = beats.length > BEAT_SHEET_PAGE ? `-${start / BEAT_SHEET_PAGE + 1}` : "";
      const sheet = await createContactSheet(
        page.map((entry) => entry.path),
        join(dir, `${name}${suffix}.jpg`),
        {
          cols: colsFor(page.length),
          maxImages: page.length,
          cellWidth,
          labelMode: "custom",
          labels: page.map(beatLabel),
        },
      );
      if (sheet) sheets.push(sheet);
    }
    return sheets;
  };
  const seams: string[] = [];
  const seamNumbers = [
    ...new Set(captured.filter((e) => e.frame.role === "seam").map((e) => e.frame.index)),
  ];
  for (const index of seamNumbers) {
    const strip = captured.filter((e) => e.frame.role === "seam" && e.frame.index === index);
    const sheet = await createContactSheet(
      strip.map((entry) => entry.path),
      join(dir, `review-seam-${pad(index)}.jpg`),
      {
        cols: strip.length,
        maxImages: strip.length,
        cellWidth: 384,
        labelMode: "custom",
        labels: strip.map(({ frame }) => `${stamp(frame.time)} ${frame.label}`),
      },
    );
    if (sheet) seams.push(sheet);
  }
  return {
    beats: await pages("review-beats", 480, (count) => (count <= 3 ? count : count <= 9 ? 3 : 4)),
    seams,
    phone: await pages("review-phone", REVIEW_PHONE_WIDTH, (count) => Math.min(4, count)),
  };
}
