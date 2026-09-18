import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
import { resolveReferencedDuration, resolveStart } from "../utils/resolveStart.js";

export interface TimelineRow extends ClipFact {
  trackKind: TrackKind;
  /** False when the source does not author a duration (media length is only known at render). */
  durationAuthored: boolean;
  /** Clips of a sub-composition, times local to the host. One level only. */
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

function readLanes(el: Element): ClipLane[] {
  const raw = el.getAttribute(HF_AUDIO_AUTOMATION_ATTR);
  if (!raw) return [];
  try {
    const fx = el.getAttribute(HF_AUDIO_FX_ATTR);
    const chain = fx ? parseAudioFxChain(fx) : undefined;
    return resolveAutomation(parseAutomation(raw), chain).lanes.map((lane) => ({
      target: lane.target,
      points: lane.points.map(({ t, v }) => ({ t, v })),
    }));
  } catch {
    return [];
  }
}

function describeRow(doc: Document, node: DomNode, baseDir: string, depth: number): TimelineRow {
  const { el } = node;
  const startCache = new Map<Element, number>();
  const start = resolveStart(doc, el, startCache, new Set());
  const authored = resolveReferencedDuration(doc, el, startCache, new Set());
  const host = el.getAttribute("data-composition-src");
  const children = host && depth === 0 ? readSubComposition(host, baseDir) : [];
  const inner = children.reduce((max, c) => Math.max(max, c.end), 0);
  const duration = authored ?? inner;
  const rate = parseNumeric(el.getAttribute("data-playback-rate"));
  return {
    id: el.id || el.getAttribute("data-composition-id") || `${el.tagName.toLowerCase()}`,
    label: null,
    kind: el.tagName.toLowerCase(),
    trackKind: trackKindOf(node).kind,
    start,
    duration,
    end: start + duration,
    trackIndex: parseNumeric(el.getAttribute("data-track-index")) ?? 0,
    src: el.getAttribute("src") ?? host,
    sourceFile: host,
    volume: parseNumeric(el.getAttribute("data-volume")),
    lanes: readLanes(el),
    playbackRate: rate === 1 ? null : rate,
    audioGroup: el.getAttribute(HF_AUDIO_GROUP_ATTR),
    role: null,
    durationAuthored: authored !== null,
    children,
  };
}

function readSubComposition(src: string, baseDir: string): TimelineRow[] {
  const file = resolve(baseDir, src);
  if (!existsSync(file)) return [];
  const doc = new DOMParser().parseFromString(readFileSync(file, "utf-8"), "text/html");
  const template = doc.querySelector("template");
  const scope = template?.content ?? doc;
  const root = scope.querySelector("[data-composition-id]");
  if (!root) return [];
  return topLevelElements(toNode(root))
    .map((node) => describeRow(doc, node, dirname(file), 1))
    .sort(byStart);
}

/** Needs a global DOMParser (`ensureDOMParser`). Reads `index.html` and one level of sub-compositions. */
export function describeProject(indexPath: string): ProjectTimeline {
  const doc = new DOMParser().parseFromString(readFileSync(indexPath, "utf-8"), "text/html");
  const root = doc.querySelector("[data-composition-id]") ?? doc.body;
  const rows = topLevelElements(toNode(root))
    .map((node) => describeRow(doc, node, dirname(indexPath), 0))
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
