import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  HF_AUDIO_AUTOMATION_ATTR,
  parseAutomation,
  resolveAutomation,
} from "@hyperframes/core/audio-automation";
import { HF_AUDIO_FX_ATTR, parseAudioFxChain } from "@hyperframes/core/audio-fx";
import { HF_AUDIO_GROUP_ATTR } from "@hyperframes/core/audio-groups";
import { byStart, type ClipFact, type ClipLane } from "@hyperframes/core/clip-facts";
import { parseNumeric } from "@hyperframes/core";
import {
  readMediaOffsetSeconds,
  readPlaybackRate,
  resolveMediaDuration,
  type MediaDurationSource,
  type MediaTag,
} from "@hyperframes/parsers/media-duration";
import {
  topLevelElements,
  trackKindOf,
  type StructureNode,
  type TrackKind,
} from "@hyperframes/parsers";
import { resolveMediaStartSeconds } from "@hyperframes/core/media-timing";
import {
  extractAudioMetadata,
  extractMediaMetadata,
  resolveReferencedDuration,
  resolveReferencedStart,
} from "@hyperframes/engine";

/** How `duration` was determined: the parsers resolver's names for media, "inner" for a composition host. */
export type DurationSource = MediaDurationSource | "inner";

export interface TimelineRow extends ClipFact {
  trackKind: TrackKind;
  /** False when the source does not author a duration (media length is only known at render). */
  durationAuthored: boolean;
  /** Where `duration` came from; `null` for a non-media row with nothing authored and no children to sum. */
  durationSource: DurationSource | null;
  /** Why no duration could be resolved; `null` unless `durationSource` is "pending". */
  pendingReason: string | null;
  /** Why `data-automation` / `data-fx-chain` could not be read; `null` when fine or absent. */
  laneError: string | null;
  /** Start and end on the main timeline, in seconds. `start`/`end` are local to the owning file's composition. */
  absStart: number;
  absEnd: number;
  /** Project-relative path of the file that declares this clip. */
  file: string;
  /** Clips of a sub-composition, `start`/`end` local to the host. One level only. */
  children: TimelineRow[];
}

export interface TimelineTrack {
  kind: TrackKind;
  rows: TimelineRow[];
}

export interface ProjectTimeline {
  duration: number;
  tracks: TimelineTrack[];
}

interface DomNode extends StructureNode<DomNode> {
  el: Element;
}

const TRACK_ORDER: readonly TrackKind[] = ["video", "graphics", "captions", "audio"];

function toNode(el: Element): DomNode {
  const attrs: Record<string, string | undefined> = {};
  for (const { name, value } of Array.from(el.attributes)) attrs[name] = value;
  return { tag: el.tagName, attrs, children: Array.from(el.children).map(toNode), el };
}

/** An unreadable chain drops only the fx lanes; the clip's own `volume` lane still shows. */
function safeChain(raw: string): ReturnType<typeof parseAudioFxChain> | undefined {
  try {
    return parseAudioFxChain(raw);
  } catch {
    return undefined;
  }
}

function readLanes(el: Element): { lanes: ClipLane[]; laneError: string | null } {
  const raw = el.getAttribute(HF_AUDIO_AUTOMATION_ATTR);
  if (!raw) return { lanes: [], laneError: null };
  try {
    const fx = el.getAttribute(HF_AUDIO_FX_ATTR);
    const chain = fx ? safeChain(fx) : undefined;
    const lanes = resolveAutomation(parseAutomation(raw), chain).lanes.map((lane) => ({
      target: lane.target,
      points: lane.points.map(({ t, v }) => ({ t, v })),
    }));
    return { lanes, laneError: null };
  } catch (err) {
    return { lanes: [], laneError: err instanceof Error ? err.message : String(err) };
  }
}

/** One per document: `startCache` memoises `data-start` references across all its rows. */
interface DocScope {
  doc: Document;
  dir: string;
  startCache: Map<Element, number>;
  /** Sub-composition files must stay inside the project. */
  projectDir: string;
  /** Main-timeline start of this document's root: 0 for index.html, the host's start for a sub-composition. */
  origin: number;
  /** Project-relative path of this document, with `/` separators. */
  file: string;
  /** Bounds concurrent ffprobe spawns for the whole run. Shared reference, not new per document. */
  withProbeSlot: <T>(fn: () => Promise<T>) => Promise<T>;
}

const MEDIA_TAG = /^(video|audio|img)$/;
const PROBE_CONCURRENCY = 4;

/** ponytail: a 4-line gate beats importing producer's Semaphore, which would pull its whole
 * dependency tree into the lightweight `timeline` command just to cap ffprobe spawns. */
export function createProbeGate(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function withProbeSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((wake) => waiting.push(wake));
    else active += 1;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

type ProbeResult = { ok: true; seconds: number } | { ok: false; reason: string };

/** ffprobe length of a media source. `extractMediaMetadata` and `extractAudioMetadata` already
 * memoize per resolved file path for the process lifetime. */
async function probeSource(scope: DocScope, el: Element, tag: MediaTag): Promise<ProbeResult> {
  const src = el.getAttribute("src");
  if (!src) return { ok: false, reason: "no src attribute" };
  if (/^https?:\/\//i.test(src)) return { ok: false, reason: "remote source not probed" };
  const file = realFileInside(scope.projectDir, resolve(scope.dir, src));
  if (!file) return { ok: false, reason: "source file not found" };
  return scope.withProbeSlot(async () => {
    try {
      const metadata =
        tag === "audio" ? await extractAudioMetadata(file) : await extractMediaMetadata(file);
      return { ok: true, seconds: metadata.durationSeconds } as const;
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) } as const;
    }
  });
}

interface DurationResolution {
  duration: number;
  durationSource: DurationSource | null;
  pendingReason: string | null;
}

function resolveContainerDuration(
  authored: number | null,
  children: readonly TimelineRow[],
): DurationResolution {
  if (authored !== null)
    return { duration: authored, durationSource: "authored", pendingReason: null };
  if (children.length === 0) return { duration: 0, durationSource: null, pendingReason: null };
  const inner = children.reduce((max, c) => Math.max(max, c.end), 0);
  return { duration: inner, durationSource: "inner", pendingReason: null };
}

/** Media rows go through the parsers resolver; only a row it cannot settle without the file is probed. */
async function resolveMediaRowDuration(
  scope: DocScope,
  el: Element,
  tag: MediaTag,
  authored: number | null,
): Promise<DurationResolution> {
  const getAttr = (name: string) => el.getAttribute(name);
  const input = {
    tag,
    authoredDurationSeconds: authored,
    mediaStartSeconds: readMediaOffsetSeconds(getAttr),
    playbackRate: readPlaybackRate(getAttr),
  };
  const unprobed = resolveMediaDuration({ ...input, sourceDurationSeconds: null });
  if (unprobed.source !== "pending") {
    return {
      duration: unprobed.seconds ?? 0,
      durationSource: unprobed.source,
      pendingReason: null,
    };
  }
  const probe = await probeSource(scope, el, tag);
  const result = resolveMediaDuration({
    ...input,
    sourceDurationSeconds: probe.ok ? probe.seconds : null,
  });
  return {
    duration: result.seconds ?? 0,
    durationSource: result.source,
    pendingReason: result.source === "pending" ? (probe.ok ? null : probe.reason) : null,
  };
}

const roundMs = (v: number) => Math.round(v * 1000) / 1000;

/** Nested media follows the runtime's own rule (core `resolveMediaStartSeconds`); everything else is host-relative. */
function mainTimelineStart(scope: DocScope, el: Element, start: number): number {
  const ordinaryStart = () => scope.origin + start;
  if (!/^(video|audio)$/i.test(el.tagName)) return ordinaryStart();
  return resolveMediaStartSeconds({
    authoredStart: parseNumeric(el.getAttribute("data-start")),
    hostStart: scope.origin,
    hasAutoStart: el.hasAttribute("data-hf-auto-start"),
    basis: el.getAttribute("data-hf-media-start-basis"),
    ordinaryStart,
  });
}

async function describeRow(scope: DocScope, node: DomNode, depth: number): Promise<TimelineRow> {
  const { el } = node;
  const { doc, startCache } = scope;
  const start = resolveReferencedStart(doc, el, startCache, new Set());
  const authored = resolveReferencedDuration(doc, el, startCache, new Set());
  const host = el.getAttribute("data-composition-src");
  const absStart = mainTimelineStart(scope, el, start);
  const children = host && depth === 0 ? await readSubComposition(host, scope, absStart) : [];
  const kind = el.tagName.toLowerCase();
  const { duration, durationSource, pendingReason } = MEDIA_TAG.test(kind)
    ? await resolveMediaRowDuration(scope, el, kind as MediaTag, authored)
    : resolveContainerDuration(authored, children);
  const rate = parseNumeric(el.getAttribute("data-playback-rate"));
  return {
    id: el.id || el.getAttribute("data-composition-id") || kind,
    label: null,
    kind,
    trackKind: trackKindOf(node).kind,
    start,
    duration,
    end: start + duration,
    absStart: roundMs(absStart),
    absEnd: roundMs(absStart + duration),
    file: scope.file,
    trackIndex: parseNumeric(el.getAttribute("data-track-index")) ?? 0,
    src: el.getAttribute("src") ?? host,
    sourceFile: host,
    volume: parseNumeric(el.getAttribute("data-volume")),
    ...readLanes(el),
    playbackRate: rate === 1 ? null : rate,
    audioGroup: el.getAttribute(HF_AUDIO_GROUP_ATTR),
    role: null,
    durationAuthored: authored !== null,
    durationSource,
    pendingReason,
    children,
  };
}

async function readSubComposition(
  src: string,
  parent: DocScope,
  origin: number,
): Promise<TimelineRow[]> {
  const authored = resolve(parent.dir, src);
  const file = realFileInside(parent.projectDir, authored);
  if (!file) return [];
  const doc = new DOMParser().parseFromString(readFileSync(file, "utf-8"), "text/html");
  const template = doc.querySelector("template");
  const root = (template?.content ?? doc).querySelector("[data-composition-id]");
  if (!root) return [];
  const scope: DocScope = {
    doc,
    dir: dirname(file),
    startCache: new Map(),
    projectDir: parent.projectDir,
    origin,
    file: relative(parent.projectDir, authored).split(sep).join("/"),
    withProbeSlot: parent.withProbeSlot,
  };
  const rows = await Promise.all(
    topLevelElements(toNode(root)).map((node) => describeRow(scope, node, 1)),
  );
  return rows.sort(byStart);
}

/** The file's real path when it is a regular file inside the project (symlinks resolved), else null. */
function realFileInside(projectDir: string, path: string): string | null {
  try {
    const real = realpathSync(path);
    const inside = relative(realpathSync(projectDir), real);
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
    return statSync(real).isFile() ? real : null;
  } catch {
    return null;
  }
}

/** Needs a global DOMParser (`ensureDOMParser`). Reads `index.html` and one level of sub-compositions. */
export async function describeProject(indexPath: string): Promise<ProjectTimeline> {
  const doc = new DOMParser().parseFromString(readFileSync(indexPath, "utf-8"), "text/html");
  const root = doc.querySelector("[data-composition-id]") ?? doc.body;
  const dir = dirname(indexPath);
  const scope: DocScope = {
    doc,
    dir,
    startCache: new Map(),
    projectDir: dir,
    origin: 0,
    file: basename(indexPath),
    withProbeSlot: createProbeGate(PROBE_CONCURRENCY),
  };
  const rows = (
    await Promise.all(topLevelElements(toNode(root)).map((node) => describeRow(scope, node, 0)))
  ).sort(byStart);
  const declared = parseNumeric(root.getAttribute("data-duration"));
  return {
    duration: declared ?? rows.reduce((max, r) => Math.max(max, r.end), 0),
    tracks: TRACK_ORDER.map((kind) => ({
      kind,
      rows: rows.filter((r) => r.trackKind === kind),
    })).filter((t) => t.rows.length > 0),
  };
}
