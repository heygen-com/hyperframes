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
import { fpsToNumber, parseFpsWithDefault, parseNumeric } from "@hyperframes/core";
import { findSyncPartner, readLinkTiming, syncOffsetFrames } from "@hyperframes/core/media-link";
import { resolveAuthoredAssetFile } from "@hyperframes/parsers/asset-resolution";
import { readCompositionFps } from "../utils/compositionFps.js";
import {
  readMediaOffsetSeconds,
  readPlaybackRate,
  resolveMediaDuration,
  type MediaDurationSource,
  type MediaTag,
} from "@hyperframes/parsers/media-duration";
import {
  isSubCompositionHost,
  topLevelElements,
  trackKindOf,
  type TrackKind,
} from "@hyperframes/parsers";
import { toDomNode, type DomNode } from "./domStructure.js";
import {
  compositionOriginSeconds,
  cutToHostSlots,
  hostInPointSeconds,
  resolveMediaStartSeconds,
  type HostSlot,
} from "@hyperframes/core/media-timing";
import {
  extractAudioMetadata,
  extractMediaMetadata,
  resolveReferencedDuration,
  resolveReferencedStart,
} from "@hyperframes/engine";

/** How `duration` was determined: the parsers resolver's names for media, "inner" for a composition host. */
export type DurationSource = MediaDurationSource | "inner";

export interface TimelineRow extends ClipFact {
  ref: string;
  warnings: string[];
  trackKind: TrackKind;
  /** False when the source does not author a duration (media length is only known at render). */
  durationAuthored: boolean;
  /** Where `duration` came from; `null` for a non-media row with nothing authored and no children to sum. */
  durationSource: DurationSource | null;
  /** Why no duration could be resolved; `null` unless `durationSource` is "pending". */
  pendingReason: string | null;
  /** Why `data-automation` / `data-fx-chain` could not be read; `null` when fine or absent. */
  laneError: string | null;
  /** Main-timeline window in seconds: the played part under an in-point host, while `duration` stays
   * the authored length. `start`/`end` are local to the owning file's composition. */
  absStart: number;
  absEnd: number;
  /** Project-relative path of the file that declares this clip. */
  file: string;
  /** Position of this row in its own kind's `rows`. Not an id: never use it to name a clip. */
  index: number;
  /** True for a clip declared inside a sub-composition. */
  nested: boolean;
  /** Plain id of the row whose `data-composition-src` declares this clip; `null` unless `nested`. */
  host: string | null;
  /** Where that host row is (its kind's `rows[index]`), for hosts whose id is missing or repeated. */
  hostRow: RowPointer | null;
  /** Rows directly inside this one: its sub-composition's clips, or timed elements nested in it. */
  children: RowPointer[];
  /** The timed row in the same file that contains this clip; `null` at a file's top level. */
  parentRow: RowPointer | null;
  /** Signed frames from its `data-sync-origin` partner (+ = late); `null` unpaired or rates differ. */
  syncOffsetFrames: number | null;
  mediaStart: number | null;
}

export interface RowPointer {
  kind: TrackKind;
  index: number;
}

/** A row before flattening: children are still row objects and refs are not assigned. */
type ClipDraft = Omit<
  TimelineRow,
  "index" | "nested" | "host" | "hostRow" | "children" | "parentRow"
> & {
  elementId: string | null;
  hfId: string | null;
  children: ClipDraft[];
  inside: ClipDraft[];
};

export interface TimelineTrack {
  kind: TrackKind;
  /** Every clip of this kind, nested ones included, by `absStart`. */
  rows: TimelineRow[];
}

export interface ProjectTimeline {
  duration: number;
  tracks: TimelineTrack[];
}

const TRACK_ORDER: readonly TrackKind[] = ["video", "graphics", "captions", "audio"];

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
  /** Main-timeline time of this document's local t=0: 0 for index.html, see `compositionOriginSeconds`. */
  origin: number;
  /** Project-relative path of this document, with `/` separators. */
  file: string;
  /** Bounds concurrent ffprobe spawns for the whole run. Shared reference, not new per document. */
  withProbeSlot: <T>(fn: () => Promise<T>) => Promise<T>;
  measure: MeasureMedia;
  sourceOverrides: ReadonlyMap<string, string>;
  fps: number;
}

/** Source length in seconds of a media file. ffprobe in production; tests pass a recorded fake. */
export type MeasureMedia = (file: string, tag: MediaTag) => Promise<number>;

const measureWithFfprobe: MeasureMedia = async (file, tag) =>
  (tag === "audio" ? await extractAudioMetadata(file) : await extractMediaMetadata(file))
    .durationSeconds;

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
  const found = resolveAuthoredAssetFile(scope.projectDir, scope.file, src);
  const file = found && realFileInside(scope.projectDir, found);
  if (!file) return { ok: false, reason: "source file not found" };
  return scope.withProbeSlot(async () => {
    try {
      return { ok: true, seconds: await scope.measure(file, tag) } as const;
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
  children: readonly { end: number }[],
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
  const measured = probe.ok && probe.seconds > 0 ? probe.seconds : null;
  const result = resolveMediaDuration({ ...input, sourceDurationSeconds: measured });
  return {
    duration: result.seconds ?? 0,
    durationSource: result.source,
    pendingReason: result.source === "pending" ? pendingReason(probe, result.reason) : null,
  };
}

/** Why a media row is pending: the probe's failure, or that it opened but reported no length. */
function pendingReason(probe: ProbeResult, resolverReason: string | undefined): string {
  if (!probe.ok) return probe.reason;
  return probe.seconds > 0
    ? (resolverReason ?? "source duration unavailable")
    : "source reports no duration";
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

interface RowTiming {
  start: number;
  authored: number | null;
  absStart: number;
  children: ClipDraft[];
  inside: ClipDraft[];
  duration: DurationResolution;
}

async function resolveRowTiming(scope: DocScope, node: DomNode, depth: number): Promise<RowTiming> {
  const { el } = node;
  const start = resolveReferencedStart(scope.doc, el, scope.startCache, new Set());
  const authored = resolveReferencedDuration(scope.doc, el, scope.startCache, new Set());
  const host = el.getAttribute("data-composition-src");
  const absStart = mainTimelineStart(scope, el, start);
  const slots: HostSlot[] =
    hostInPointSeconds(el) > 0 ? [{ start: absStart, end: absStart + (authored ?? Infinity) }] : [];
  const children =
    host && depth === 0
      ? await readSubComposition(host, scope, compositionOriginSeconds(absStart, el), slots)
      : [];
  const inside = isSubCompositionHost(node)
    ? []
    : await Promise.all(topLevelElements(node).map((inner) => describeRow(scope, inner, depth)));
  const kind = el.tagName.toLowerCase();
  const duration = MEDIA_TAG.test(kind)
    ? await resolveMediaRowDuration(scope, el, kind as MediaTag, authored)
    : resolveContainerDuration(authored, children);
  return { start, authored, absStart, children, inside, duration };
}

function describeRowFields(scope: DocScope, node: DomNode, timing: RowTiming): ClipDraft {
  const { el } = node;
  const kind = el.tagName.toLowerCase();
  const host = el.getAttribute("data-composition-src");
  const rate = parseNumeric(el.getAttribute("data-playback-rate"));
  return {
    id: el.id || el.getAttribute("data-composition-id") || kind,
    label: null,
    kind,
    trackKind: trackKindOf(node).kind,
    start: timing.start,
    duration: timing.duration.duration,
    end: timing.start + timing.duration.duration,
    absStart: roundMs(timing.absStart),
    absEnd: roundMs(timing.absStart + timing.duration.duration),
    file: scope.file,
    trackIndex: parseNumeric(el.getAttribute("data-track-index")) ?? 0,
    src: el.getAttribute("src") ?? host,
    sourceFile: host,
    volume: parseNumeric(el.getAttribute("data-volume")),
    ...readLanes(el),
    playbackRate: rate === 1 ? null : rate,
    audioGroup: el.getAttribute(HF_AUDIO_GROUP_ATTR),
    role: null,
    durationAuthored: timing.authored !== null,
    durationSource: timing.duration.durationSource,
    pendingReason: timing.duration.pendingReason,
    children: timing.children,
    inside: timing.inside,
    ref: "",
    warnings: [],
    elementId: el.id || null,
    hfId: el.getAttribute("data-hf-id"),
    syncOffsetFrames: syncOffsetOf(el, scope.fps),
    mediaStart: /^(video|audio)$/.test(kind)
      ? readMediaOffsetSeconds((name) => el.getAttribute(name))
      : null,
  };
}

function syncOffsetOf(el: Element, fps: number): number | null {
  const partner = findSyncPartner(el);
  return partner ? syncOffsetFrames(readLinkTiming(el), readLinkTiming(partner), fps) : null;
}

async function describeRow(scope: DocScope, node: DomNode, depth: number): Promise<ClipDraft> {
  return describeRowFields(scope, node, await resolveRowTiming(scope, node, depth));
}

async function readSubComposition(
  src: string,
  parent: DocScope,
  origin: number,
  slots: readonly HostSlot[],
): Promise<ClipDraft[]> {
  const authored = resolve(parent.dir, src);
  const file = realFileInside(parent.projectDir, authored);
  if (!file) return [];
  const relativeFile = relative(parent.projectDir, authored).split(sep).join("/");
  const source = parent.sourceOverrides.get(relativeFile) ?? readFileSync(file, "utf-8");
  const doc = new DOMParser().parseFromString(source, "text/html");
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
    measure: parent.measure,
    sourceOverrides: parent.sourceOverrides,
    fps: parent.fps,
  };
  const rows = await Promise.all(
    topLevelElements(toDomNode(root)).map((node) => describeRow(scope, node, 1)),
  );
  return rows.flatMap((row) => cutRow(row, slots)).sort(byStart);
}

function cutRow(row: ClipDraft, slots: readonly HostSlot[]): ClipDraft[] {
  const kept = cutToHostSlots({ start: row.absStart, end: row.absEnd }, slots);
  if (kept.end === kept.start && row.absEnd > row.absStart) return [];
  const skipped = (kept.start - row.absStart) * (row.playbackRate ?? 1);
  const mediaStart = row.mediaStart === null ? null : roundMs(row.mediaStart + skipped);
  const inside = row.inside.flatMap((inner) => cutRow(inner, slots));
  return [{ ...row, absStart: roundMs(kept.start), absEnd: roundMs(kept.end), mediaStart, inside }];
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

/** One flat, `absStart`-ordered list per kind holding every clip once; `children` become refs into those lists. */
function flatten(top: ClipDraft[]): TimelineTrack[] {
  type Entry = { clip: ClipDraft; host: ClipDraft | null; parent: ClipDraft | null };
  const entries: Entry[] = [];
  const add = (clip: ClipDraft, host: ClipDraft | null, parent: ClipDraft | null) => {
    entries.push({ clip, host, parent });
    for (const inner of clip.inside) add(inner, host, clip);
    for (const child of clip.children) add(child, clip, null);
  };
  for (const clip of top) add(clip, null, null);
  const byKind = TRACK_ORDER.map((kind) => ({
    kind,
    entries: entries
      .filter((e) => e.clip.trackKind === kind)
      .sort((a, b) => a.clip.absStart - b.clip.absStart),
  })).filter((t) => t.entries.length > 0);
  const pointers = new Map<ClipDraft, RowPointer>(
    byKind.flatMap((t) => t.entries.map((e, index) => [e.clip, { kind: t.kind, index }] as const)),
  );
  const at = (clip: ClipDraft) => pointers.get(clip)!;
  const fileIds = new Map<string, Map<string, number>>();
  for (const { entries } of byKind) {
    for (const { clip } of entries) {
      if (!clip.elementId) continue;
      const ids = fileIds.get(clip.file) ?? new Map<string, number>();
      ids.set(clip.elementId, (ids.get(clip.elementId) ?? 0) + 1);
      fileIds.set(clip.file, ids);
    }
  }
  return byKind.map(({ kind, entries: kindEntries }) => ({
    kind,
    rows: kindEntries.map(({ clip, host, parent }, index) => {
      const uniqueId = clip.elementId && fileIds.get(clip.file)?.get(clip.elementId) === 1;
      const ref = uniqueId
        ? `#${clip.elementId}`
        : clip.hfId
          ? `hf:${clip.hfId}`
          : `${kind}/${index}`;
      const warnings = [
        ...(uniqueId || clip.hfId
          ? []
          : [
              'row has no stable name; add id="<name>" to the element in this file, then retry with #<name>',
            ]),
        ...neverVisibleWarning(clip, parent),
      ];
      return {
        ...clip,
        index,
        ref,
        warnings,
        nested: host !== null,
        host: host && host.id,
        hostRow: host && at(host),
        children: [...clip.children, ...clip.inside].map(at),
        parentRow: parent && at(parent),
      };
    }),
  }));
}

/** The runtime shows a nested clip only inside its parent's window, and its data-start counts from the composition. */
export const NEVER_VISIBLE = "never visible";

function neverVisibleWarning(clip: ClipDraft, parent: ClipDraft | null): string[] {
  if (!parent || clip.kind === "audio") return [];
  if (clip.absEnd <= clip.absStart || parent.absEnd <= parent.absStart) return [];
  if (clip.absEnd > parent.absStart && clip.absStart < parent.absEnd) return [];
  const name = parent.elementId ? `#${parent.elementId}` : `its parent <${parent.kind}>`;
  return [
    `${NEVER_VISIBLE}: plays ${clip.absStart}-${clip.absEnd}s, but ${name} only shows ${parent.absStart}-${parent.absEnd}s; a nested data-start counts from the composition, not from ${name}`,
  ];
}

function projectFps(source: string): number {
  const parsed = parseFpsWithDefault(readCompositionFps(source) ?? undefined);
  return fpsToNumber(parsed.ok ? parsed.value : { num: 30, den: 1 });
}

/** Needs a global DOMParser (`ensureDOMParser`). Reads `index.html` and one level of sub-compositions. */
export async function describeProject(
  indexPath: string,
  measure: MeasureMedia = measureWithFfprobe,
  sourceOverrides: ReadonlyMap<string, string> = new Map(),
): Promise<ProjectTimeline> {
  const projectDir = dirname(indexPath);
  const source = sourceOverrides.get(basename(indexPath)) ?? readFileSync(indexPath, "utf-8");
  const doc = new DOMParser().parseFromString(source, "text/html");
  const root = doc.querySelector("[data-composition-id]") ?? doc.body;
  const dir = projectDir;
  const scope: DocScope = {
    doc,
    dir,
    startCache: new Map(),
    projectDir: dir,
    origin: 0,
    file: basename(indexPath),
    withProbeSlot: createProbeGate(PROBE_CONCURRENCY),
    measure,
    sourceOverrides,
    fps: projectFps(source),
  };
  const rows = (
    await Promise.all(topLevelElements(toDomNode(root)).map((node) => describeRow(scope, node, 0)))
  ).sort(byStart);
  const declared = parseNumeric(root.getAttribute("data-duration"));
  return {
    duration: declared ?? rows.reduce((max, r) => Math.max(max, r.end), 0),
    tracks: flatten(rows),
  };
}
