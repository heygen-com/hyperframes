import { END_CARD_HOLD_SEC, type Canvas } from "./motionAudit.js";
import type { CheckBbox, CraftFinding, CraftFrame, CraftResult } from "./checkTypes.js";

/**
 * Craft thresholds. Line holds follow the skills' target of 0.5 s + 0.3 s a word and warn
 * at three quarters of it; a one- or two-word chapter line may flash for 0.4 s, as the
 * official films do. Heights and sizes scale with the frame's short side (1080 px reference).
 */
const CRAFT_THRESHOLDS = {
  readHeightAt1080: 30,
  readOpacity: 0.5,
  shortLineWords: 2,
  shortLineFloorSec: 0.4,
  holdBaseSec: 0.5,
  holdPerWordSec: 0.3,
  holdFloorFraction: 0.75,
  finalLineFloorSec: 2,
  deadStretchSec: 3,
  endCardSec: END_CARD_HOLD_SEC,
  typeFloorFraction: 0.026,
  typeFloorHoldSec: 0.5,
  silentFilmSec: 15,
  /** One video frame: a line held exactly at its floor measures a hair under it. */
  measureToleranceSec: 1 / 30,
  /** Halvings of a grid step when re-measuring a line's edges (0.125 s → ~8 ms). */
  refineSteps: 4,
  maxRefinedLines: 24,
} as const;

const T = CRAFT_THRESHOLDS;
const ZERO_BBOX: CheckBbox = { x: 0, y: 0, width: 0, height: 0 };
const WORD_RUNS = /[\p{L}\p{M}\p{N}%$]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;
// Chinese and Japanese have no spaces; a dictionary segmenter counts their words like an English line's.
const WORD_SEGMENTER = new Intl.Segmenter("ja", { granularity: "word" });

/** Words a viewer reads: letter/number runs, with CJK runs split into dictionary words. */
export function readingWords(text: string): number {
  const runs = text.toLowerCase().normalize("NFC").match(WORD_RUNS) ?? [];
  return runs.reduce(
    (count, run) =>
      count + Math.max(1, [...WORD_SEGMENTER.segment(run)].filter((s) => s.isWordLike).length),
    0,
  );
}

function lineTargetSec(words: number): number {
  return T.holdBaseSec + T.holdPerWordSec * words;
}

/** Shortest hold that does not warn; the film's last line needs at least 2 s. */
export function lineFloorSec(words: number, finalLine: boolean): number {
  const floor =
    words <= T.shortLineWords ? T.shortLineFloorSec : T.holdFloorFraction * lineTargetSec(words);
  return finalLine ? Math.max(floor, T.finalLineFloorSec) : floor;
}

export interface CraftAuditInput {
  frames: CraftFrame[];
  duration: number;
  canvas: Canvas;
  soundSources: number | null;
  /** sweep_static fired, a whole-composition keepsMoving owns stillness, or the root says data-no-timeline. */
  stillnessJudgedElsewhere: boolean;
}

/** Seeks to `time` and samples it again, for re-measuring a line's edges between grid samples. */
export type CraftProbe = (time: number) => Promise<CraftFrame>;

export async function auditCraft(input: CraftAuditInput, probe?: CraftProbe): Promise<CraftResult> {
  const frames = [...input.frames].sort((a, b) => a.time - b.time);
  const step = sampleStep(frames);
  const findings: CraftFinding[] = [
    ...detectFirstFrameEmpty(frames),
    ...(await detectLineUnread(frames, input.duration, input.canvas, probe)),
    ...(input.stillnessJudgedElsewhere ? [] : detectDeadStretches(frames, input.duration)),
    ...detectTextBelowFloor(frames, input.duration, input.canvas),
    ...detectFilmSilent(input.duration, input.soundSources),
  ].sort((a, b) => a.time - b.time);
  return { enabled: true, step, samples: frames.length, findings };
}

function sampleStep(frames: CraftFrame[]): number {
  const gaps = frames
    .slice(1)
    .map((frame, index) => frame.time - (frames[index]?.time ?? frame.time))
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

function seconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

function filmFinding(
  code: CraftFinding["code"],
  time: number,
  message: string,
  extra: Partial<CraftFinding> = {},
): CraftFinding {
  return {
    code,
    severity: "warning",
    message,
    selector: "[data-composition-id]",
    dataAttributes: {},
    sourceFile: "index.html",
    bbox: ZERO_BBOX,
    time,
    ...extra,
  };
}

// ---------- first_frame_empty ----------

export function detectFirstFrameEmpty(frames: CraftFrame[]): CraftFinding[] {
  const first = frames[0];
  if (!first || first.time > 1e-3) return [];
  if (first.coveredBy) {
    return [
      filmFinding(
        "first_frame_empty",
        0,
        `Frame 0 is covered by ${first.coveredBy}: an opaque element over the canvas hides every other clip, and the first frame is the thumbnail on social players. Move it below the content; see canvas_covered.`,
      ),
    ];
  }
  if (first.painted) return [];
  return [
    filmFinding(
      "first_frame_empty",
      0,
      "Frame 0 shows only the background, and the first frame is the thumbnail on social players: have the title or key image already on screen at 0 s instead of entering from nothing; see references/review.md.",
    ),
  ];
}

// ---------- film_silent ----------

export function detectFilmSilent(duration: number, soundSources: number | null): CraftFinding[] {
  if (soundSources === null || soundSources > 0 || duration <= T.silentFilmSec) return [];
  return [
    filmFinding(
      "film_silent",
      0,
      `This ${Math.round(duration)} s film has no sound source (no <audio>, no <video> with sound): add a music bed and sounds on the visible actions unless the person asked for silence; see references/sound.md.`,
    ),
  ];
}

// ---------- dead_stretch ----------

/** Runs of identical liveness signatures longer than 3 s, outside the end card and data-hold. */
export function detectDeadStretches(frames: CraftFrame[], duration: number): CraftFinding[] {
  const endCardStart = duration - T.endCardSec;
  const findings: CraftFinding[] = [];
  let start: number | null = null;
  let end = 0;
  const flush = () => {
    if (start !== null && end - start > T.deadStretchSec) findings.push(deadStretch(start, end));
    start = null;
  };
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1];
    const after = frames[index];
    if (!before || !after) continue;
    const still =
      before.signature !== "" &&
      before.signature === after.signature &&
      !before.held &&
      !after.held &&
      before.time < endCardStart;
    if (!still) {
      flush();
      continue;
    }
    start ??= before.time;
    end = Math.min(after.time, endCardStart);
  }
  flush();
  return findings;
}

function deadStretch(start: number, end: number): CraftFinding {
  const length = end - start;
  return filmFinding(
    "dead_stretch",
    start,
    `Nothing on screen changes for ${seconds(length)} (${start.toFixed(2)}–${end.toFixed(2)} s): start the next move within ${T.deadStretchSec} s, or put data-hold on the element whose stillness is deliberate; see references/motion.md.`,
    { seconds: round(length), floorSeconds: T.deadStretchSec, until: round(end) },
  );
}

// ---------- line_unread ----------

interface BlockFrame {
  text: string;
  rect: CraftRect;
}

interface CraftRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface BlockTrack {
  key: number;
  selector: string;
  sourceFile: string;
  /** Frame index → what the block showed there. */
  seen: Map<number, BlockFrame>;
}

/** Readable blocks in one frame: non-caption parts at ≥ 0.5 opacity whose union is reading-sized. */
function readableBlocks(frame: CraftFrame, readHeight: number): Map<number, BlockFrame & Anchor> {
  const blocks = new Map<number, BlockFrame & Anchor>();
  for (const part of frame.parts) {
    if (part.captions || part.opacity < T.readOpacity) continue;
    const rect = {
      left: part.rect.left,
      top: part.rect.top,
      right: part.rect.left + part.rect.width,
      bottom: part.rect.top + part.rect.height,
    };
    const block = blocks.get(part.block);
    if (!block) {
      blocks.set(part.block, {
        text: part.text,
        rect,
        selector: part.blockSelector,
        sourceFile: part.sourceFile,
      });
      continue;
    }
    block.text = `${block.text} ${part.text}`;
    block.rect = {
      left: Math.min(block.rect.left, rect.left),
      top: Math.min(block.rect.top, rect.top),
      right: Math.max(block.rect.right, rect.right),
      bottom: Math.max(block.rect.bottom, rect.bottom),
    };
  }
  for (const [key, block] of blocks) {
    if (block.rect.bottom - block.rect.top < readHeight) blocks.delete(key);
  }
  return blocks;
}

interface Anchor {
  selector: string;
  sourceFile: string;
}

function trackBlocks(frames: CraftFrame[], readHeight: number): BlockTrack[] {
  const tracks = new Map<number, BlockTrack>();
  frames.forEach((frame, index) => {
    for (const [key, block] of readableBlocks(frame, readHeight)) {
      const track = tracks.get(key) ?? {
        key,
        selector: block.selector,
        sourceFile: block.sourceFile,
        seen: new Map<number, BlockFrame>(),
      };
      track.seen.set(index, { text: block.text, rect: block.rect });
      tracks.set(key, track);
    }
  });
  return [...tracks.values()];
}

/** Maximal runs of consecutive frame indices. */
function indexRuns(indices: number[]): [number, number][] {
  const sorted = [...indices].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const index of sorted) {
    const last = runs[runs.length - 1];
    if (last && index === last[1] + 1) last[1] = index;
    else runs.push([index, index]);
  }
  return runs;
}

/** A line's on-screen window: it starts in (startOut, startIn] and ends in [endIn, endOut). */
interface LineWindow {
  startOut: number;
  startIn: number;
  endIn: number;
  endOut: number;
}

function windowSeconds(window: LineWindow): number {
  return (window.endIn + window.endOut) / 2 - (window.startOut + window.startIn) / 2;
}

interface LineCandidate {
  track: BlockTrack;
  words: number;
  text: string;
  finalLine: boolean;
  floor: number;
  window: LineWindow;
  firstIndex: number;
}

/** A run that reaches the last sample lasts to the film's end; one at sample 0 starts exactly there. */
function runWindow(
  frames: CraftFrame[],
  [first, last]: [number, number],
  duration: number,
): LineWindow {
  const timeAt = (index: number) =>
    frames[Math.min(Math.max(index, 0), frames.length - 1)]?.time ?? 0;
  const reachesEnd = last === frames.length - 1;
  return {
    startOut: timeAt(first - 1),
    startIn: timeAt(first),
    endIn: reachesEnd ? duration : timeAt(last),
    endOut: reachesEnd ? duration : timeAt(last + 1),
  };
}

function lineCandidates(frames: CraftFrame[], duration: number, canvas: Canvas): LineCandidate[] {
  const readHeight = T.readHeightAt1080 * (Math.min(canvas.width, canvas.height) / 1080);
  const tracks = trackBlocks(frames, readHeight);
  const lastEnd = (track: BlockTrack) => Math.max(...track.seen.keys());
  const latest = Math.max(-1, ...tracks.map(lastEnd));
  const candidates: LineCandidate[] = [];
  for (const track of tracks) {
    const runs = indexRuns([...track.seen.keys()]);
    const finalLine = lastEnd(track) === latest;
    const windows = runs.map((run) => runWindow(frames, run, duration));
    const chosen = finalLine
      ? windows.length - 1
      : windows.reduce((best, window, index) => {
          const bestWindow = windows[best];
          return bestWindow && windowSeconds(window) > windowSeconds(bestWindow) ? index : best;
        }, 0);
    const window = windows[chosen];
    const run = runs[chosen];
    if (!window || !run) continue;
    const texts = [...track.seen.values()].map((seen) => seen.text);
    const text = texts.reduce((longest, next) =>
      readingWords(next) > readingWords(longest) ? next : longest,
    );
    const words = readingWords(text);
    if (words === 0) continue;
    const floor = lineFloorSec(words, finalLine);
    // Clearly long enough even at the shortest the grid allows.
    if (window.endIn - window.startIn >= floor) continue;
    candidates.push({ track, words, text, finalLine, floor, window, firstIndex: run[0] });
  }
  return candidates;
}

async function refineWindow(
  candidate: LineCandidate,
  probe: CraftProbe,
  canvas: Canvas,
): Promise<LineWindow> {
  const readHeight = T.readHeightAt1080 * (Math.min(canvas.width, canvas.height) / 1080);
  const visibleAt = async (time: number) =>
    readableBlocks(await probe(time), readHeight).has(candidate.track.key);
  const window = { ...candidate.window };
  for (let step = 0; step < T.refineSteps; step += 1) {
    if (window.startIn > window.startOut) {
      const mid = (window.startOut + window.startIn) / 2;
      if (await visibleAt(mid)) window.startIn = mid;
      else window.startOut = mid;
    }
    if (window.endOut > window.endIn) {
      const mid = (window.endIn + window.endOut) / 2;
      if (await visibleAt(mid)) window.endIn = mid;
      else window.endOut = mid;
    }
  }
  return window;
}

export async function detectLineUnread(
  frames: CraftFrame[],
  duration: number,
  canvas: Canvas,
  probe?: CraftProbe,
): Promise<CraftFinding[]> {
  const findings: CraftFinding[] = [];
  const candidates = lineCandidates(frames, duration, canvas);
  for (const [index, candidate] of candidates.entries()) {
    const window =
      probe && index < T.maxRefinedLines
        ? await refineWindow(candidate, probe, canvas)
        : candidate.window;
    const held = windowSeconds(window);
    if (held >= candidate.floor - T.measureToleranceSec) continue;
    const error = Math.max(window.startIn - window.startOut, window.endOut - window.endIn) / 2;
    findings.push(lineUnreadFinding(candidate, window, held, error));
  }
  return findings;
}

function lineUnreadFinding(
  candidate: LineCandidate,
  window: LineWindow,
  held: number,
  error: number,
): CraftFinding {
  const { track, words, text, finalLine, floor } = candidate;
  const quoted = quote(text, 60);
  const wordLabel = `${words} word${words === 1 ? "" : "s"}`;
  const measured = `${seconds(held)} (±${Math.max(0.01, error).toFixed(2)} s)`;
  const target = lineTargetSec(words);
  const message = finalLine
    ? `The film's last line ${quoted} (${wordLabel}) is on screen ${measured}, under the ${seconds(floor)} a closing line needs: hold it about 0.5 s + 0.3 s a word and at least 2 s before the film ends; see references/motion.md.`
    : `${quoted} (${wordLabel}) is on screen ${measured}, under its ${seconds(floor)} floor: hold it about 0.5 s + 0.3 s a word (${seconds(target)} here) before it leaves or changes; see references/motion.md.`;
  const firstSeen = track.seen.get(candidate.firstIndex);
  const rect = firstSeen?.rect;
  return {
    code: "line_unread",
    severity: "warning",
    message,
    text,
    selector: track.selector,
    dataAttributes: {},
    sourceFile: track.sourceFile,
    bbox: rect
      ? { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }
      : ZERO_BBOX,
    time: round(window.startIn),
    words,
    seconds: round(held),
    floorSeconds: round(floor),
  };
}

// ---------- text_below_floor ----------

interface SmallText {
  selector: string;
  sourceFile: string;
  text: string;
  fontPx: number;
  seconds: number;
  time: number;
  bbox: CheckBbox;
}

/** 2.6% of the short side, rounded: 28 px on 1080. */
export function typeFloorPx(canvas: Canvas): number {
  return Math.round(T.typeFloorFraction * Math.min(canvas.width, canvas.height));
}

export function detectTextBelowFloor(
  frames: CraftFrame[],
  duration: number,
  canvas: Canvas,
): CraftFinding[] {
  const floorPx = typeFloorPx(canvas);
  const step = sampleStep(frames);
  const sightings = new Map<number, Map<number, CraftFrame["parts"][number]>>();
  frames.forEach((frame, index) => {
    for (const part of frame.parts) {
      if (part.captions || part.opacity < T.readOpacity) continue;
      // Half a pixel of slack: a scaled 28 px line measures 27.9.
      if (part.fontPx >= floorPx - 0.5 || readingWords(part.text) === 0) continue;
      const seen = sightings.get(part.key) ?? new Map();
      seen.set(index, part);
      sightings.set(part.key, seen);
    }
  });
  const small: SmallText[] = [];
  for (const seen of sightings.values()) {
    const [first, last] = longestRun(indexRuns([...seen.keys()]));
    const start = frames[first]?.time ?? 0;
    const end = last === frames.length - 1 ? duration : (frames[last]?.time ?? start) + step;
    if (end - start < T.typeFloorHoldSec) continue;
    const parts = [...seen.values()];
    const part = parts[0];
    if (!part) continue;
    small.push({
      selector: part.selector,
      sourceFile: part.sourceFile,
      text: part.text,
      fontPx: Math.min(...parts.map((entry) => entry.fontPx)),
      seconds: end - start,
      time: start,
      bbox: {
        x: part.rect.left,
        y: part.rect.top,
        width: part.rect.width,
        height: part.rect.height,
      },
    });
  }
  const shortSide = Math.min(canvas.width, canvas.height);
  return groupBySourceFile(small).map((group) => smallTextFinding(group, floorPx, shortSide));
}

function longestRun(runs: [number, number][]): [number, number] {
  return runs.reduce((best, run) => (run[1] - run[0] > best[1] - best[0] ? run : best), [0, -1]);
}

/** One finding per file (a scene, with sub-compositions), anchored on its smallest text. */
function groupBySourceFile(small: SmallText[]): SmallText[][] {
  const groups = new Map<string, SmallText[]>();
  for (const entry of small)
    groups.set(entry.sourceFile, [...(groups.get(entry.sourceFile) ?? []), entry]);
  return [...groups.values()].map((group) =>
    group.sort((a, b) => a.fontPx - b.fontPx || a.time - b.time),
  );
}

function quote(text: string, max: number): string {
  return `"${text.length > max ? `${text.slice(0, max - 3)}...` : text}"`;
}

function smallTextFinding(group: SmallText[], floorPx: number, shortSide: number): CraftFinding {
  const [smallest] = group;
  if (!smallest) throw new Error("text_below_floor group is empty");
  const subject =
    group.length === 1
      ? `${quote(smallest.text, 48)} renders at ${Math.round(smallest.fontPx)} px for ${seconds(smallest.seconds)}`
      : `${group.length} text elements stay under it for 0.5 s or more, the smallest ${quote(smallest.text, 40)} at ${Math.round(smallest.fontPx)} px`;
  const byTime = [...group].sort((a, b) => a.time - b.time);
  return {
    code: "text_below_floor",
    severity: "warning",
    message: `Type floor is ${floorPx} px (2.6% of the ${shortSide} px short side, what a phone can read) and ${subject}: set reading text to at least ${floorPx} px, or put data-layout-ignore on text that is texture rather than reading; see references/look.md.`,
    text: smallest.text,
    selector: smallest.selector,
    dataAttributes: {},
    sourceFile: smallest.sourceFile,
    bbox: smallest.bbox,
    time: round(smallest.time),
    times: byTime.map((entry) => round(entry.time)),
    fontPx: round(smallest.fontPx),
    floorPx,
    seconds: round(smallest.seconds),
    elements: group.map((entry) => ({
      selector: entry.selector,
      text: entry.text,
      fontPx: round(entry.fontPx),
      time: round(entry.time),
      seconds: round(entry.seconds),
    })),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
