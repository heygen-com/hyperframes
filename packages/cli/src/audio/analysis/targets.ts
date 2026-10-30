import { dirname, join, resolve } from "node:path";
import { resolveAuthoredAssetFile } from "@hyperframes/parsers/asset-resolution";
import type { ProjectTimeline, TimelineRow } from "../../timeline/describeProject.js";

/** Where a file sits in the film: film time = start + (file time − mediaStart) / playbackRate. */
export interface Placement {
  start: number;
  end: number;
  /** The element's own `data-start`: local to its composition, so it differs from `start` inside a sub-composition. */
  dataStart: number;
  mediaStart: number;
  playbackRate: number;
  volume: number;
}

export interface AudioTarget {
  /** Absolute path of the media file. */
  path: string;
  /** The path as the project or the caller wrote it. */
  file: string;
  ref: string | null;
  kind: "audio" | "video" | "file";
  placement: Placement | null;
  /** The part of the file to analyze, in file seconds; the whole file when absent. */
  window?: { from: number; seconds: number };
  clip?: { from: number; seconds: number };
}

export type FilmQuery =
  | { by: "all" }
  | { by: "element"; ref: string }
  | { by: "at"; t: number }
  | { by: "range"; start: number; end: number };

const round = (t: number) => Math.round(t * 1000) / 1000;

function placementOf(row: TimelineRow): Placement {
  return {
    start: row.absStart,
    end: row.absEnd,
    dataStart: row.start,
    mediaStart: row.mediaStart ?? 0,
    playbackRate: row.playbackRate ?? 1,
    volume: row.volume ?? 1,
  };
}

export function filmTime(placement: Placement, fileTime: number): number {
  return round(placement.start + (fileTime - placement.mediaStart) / placement.playbackRate);
}

export function fileTime(placement: Placement, filmTime: number): number {
  return round(placement.mediaStart + (filmTime - placement.start) * placement.playbackRate);
}

const soundingRows = (timeline: ProjectTimeline) =>
  timeline.tracks
    .filter((track) => track.kind === "audio" || track.kind === "video")
    .flatMap((track) => track.rows)
    .filter((row) => row.src && row.volume !== 0 && /^(audio|video)$/.test(row.kind))
    .sort((a, b) => a.absStart - b.absStart);

function matches(row: TimelineRow, query: FilmQuery): boolean {
  switch (query.by) {
    case "all":
    case "element":
      return true;
    case "at":
      return row.absStart <= query.t && query.t < row.absEnd;
    case "range":
      return row.absStart < query.end && query.start < row.absEnd;
  }
}

function targetOf(projectDir: string, row: TimelineRow, query: FilmQuery): AudioTarget {
  const placement = placementOf(row);
  const from = query.by === "range" ? Math.max(placement.start, query.start) : placement.start;
  const to = query.by === "range" ? Math.min(placement.end, query.end) : placement.end;
  return {
    path:
      resolveAuthoredAssetFile(projectDir, row.file, row.src!) ??
      resolve(dirname(join(projectDir, row.file)), row.src!),
    file: row.src!,
    ref: row.ref || null,
    kind: row.kind as "audio" | "video",
    placement,
    window: {
      from: fileTime(placement, from),
      seconds: round((to - from) * placement.playbackRate),
    },
    clip: {
      from: placement.mediaStart,
      seconds: round((placement.end - placement.start) * placement.playbackRate),
    },
  };
}

/** The film's sounding clips a query covers, each with the part of its file that plays. */
export function filmTargets(
  projectDir: string,
  timeline: ProjectTimeline,
  query: FilmQuery,
): AudioTarget[] {
  if (query.by === "element") {
    const id = query.ref.startsWith("#") ? query.ref.slice(1) : null;
    const found = timeline.tracks
      .flatMap((track) => track.rows)
      .filter((row) => row.ref === query.ref || (id !== null && row.id === id));
    if (found.length !== 1)
      throw new Error(
        `${query.ref} ${found.length ? `matches ${found.length} clips` : "was not found"}; use a ref from hyperframes timeline`,
      );
    const row = found[0]!;
    if (!row.src || !/^(audio|video)$/.test(row.kind))
      throw new Error(`${query.ref} is not an audio or video clip`);
    return [targetOf(projectDir, row, query)];
  }
  return soundingRows(timeline)
    .filter((row) => matches(row, query))
    .map((row) => targetOf(projectDir, row, query));
}
