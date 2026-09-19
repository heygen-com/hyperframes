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
  topLevelElements,
  trackKindOf,
  type StructureNode,
  type TrackKind,
} from "@hyperframes/parsers";
import { resolveAbsoluteMediaStartSeconds } from "@hyperframes/core/media-timing";
import { resolveReferencedDuration, resolveReferencedStart } from "@hyperframes/engine";

export interface TimelineRow extends ClipFact {
  trackKind: TrackKind;
  /** False when the source does not author a duration (media length is only known at render). */
  durationAuthored: boolean;
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
}

const roundMs = (v: number) => Math.round(v * 1000) / 1000;

/** Runtime rule: nested media is host-relative unless marked global (core `resolveAbsoluteMediaStartSeconds`). */
function mainTimelineStart(scope: DocScope, el: Element, start: number): number {
  const authored = /^(video|audio)$/i.test(el.tagName)
    ? parseNumeric(el.getAttribute("data-start"))
    : null;
  if (authored === null) return scope.origin + start;
  return resolveAbsoluteMediaStartSeconds({
    authoredStart: authored,
    hostStart: scope.origin,
    basis: el.getAttribute("data-hf-media-start-basis"),
  });
}

function describeRow(scope: DocScope, node: DomNode, depth: number): TimelineRow {
  const { el } = node;
  const { doc, startCache } = scope;
  const start = resolveReferencedStart(doc, el, startCache, new Set());
  const authored = resolveReferencedDuration(doc, el, startCache, new Set());
  const host = el.getAttribute("data-composition-src");
  const absStart = mainTimelineStart(scope, el, start);
  const children = host && depth === 0 ? readSubComposition(host, scope, absStart) : [];
  const inner = children.reduce((max, c) => Math.max(max, c.end), 0);
  const duration = authored ?? inner;
  const rate = parseNumeric(el.getAttribute("data-playback-rate"));
  const kind = el.tagName.toLowerCase();
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
    children,
  };
}

function readSubComposition(src: string, parent: DocScope, origin: number): TimelineRow[] {
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
  };
  return topLevelElements(toNode(root))
    .map((node) => describeRow(scope, node, 1))
    .sort(byStart);
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
export function describeProject(indexPath: string): ProjectTimeline {
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
  };
  const rows = topLevelElements(toNode(root))
    .map((node) => describeRow(scope, node, 0))
    .sort(byStart);
  const declared = parseNumeric(root.getAttribute("data-duration"));
  return {
    duration: declared ?? rows.reduce((max, r) => Math.max(max, r.end), 0),
    tracks: TRACK_ORDER.map((kind) => ({
      kind,
      rows: rows.filter((r) => r.trackKind === kind),
    })).filter((t) => t.rows.length > 0),
  };
}
