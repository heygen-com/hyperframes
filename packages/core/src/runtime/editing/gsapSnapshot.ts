// The frame's GSAP tweens as plain data, for a parent that cannot reach the frame's window.
import type { EditingElementHandle } from "../editingElement";
import { handleFor } from "../editingHandles";
import { MOVES, rendersTransform, withoutGsapTakeover } from "../editingGestureStart";
import { isPlainRecord } from "../editingPort";
import { isElementNode } from "../domRealm";
import {
  MAX_SNAPSHOT_CHANNELS,
  MAX_SNAPSHOT_FIELDS,
  MAX_SNAPSHOT_TARGETS,
  MAX_SNAPSHOT_TEXT,
  MAX_SNAPSHOT_TWEENS,
  MAX_VARS_DEPTH,
  TARGET_FIELDS,
  TIMELINE_FIELDS,
} from "./gsapSnapshotLimits";

export type SnapshotValue =
  | number
  | string
  | boolean
  | null
  | SnapshotValue[]
  | { [key: string]: SnapshotValue };

export interface GsapSnapshotTween {
  targets: EditingElementHandle[];
  /** The tween's vars; functions, elements and other live objects are left out. */
  vars: Record<string, SnapshotValue>;
  start: number;
  duration: number;
  from: boolean;
  initted: boolean;
  /** GSAP's parse of each channel: start `s` and change `c`. */
  parsed: Array<{ p: string; s: number; c: number }>;
  /** A keyframed tween's steps, timed within the tween. */
  parts: GsapSnapshotTween[];
}

export interface GsapSnapshotTimeline {
  id: string;
  time: number | null;
  defaultEase: string | null;
  tweens: GsapSnapshotTween[];
}

export interface GsapSnapshotTarget {
  handle: EditingElementHandle;
  id: string;
  className: string;
  /** GSAP's current value of each channel a tween animates, and of x and y. */
  values: Record<string, number>;
}

export interface GsapSnapshot {
  /** The player's time when read; null without a player. */
  time: number | null;
  defaultEase: string | null;
  timelines: GsapSnapshotTimeline[];
  globalTweens: GsapSnapshotTween[];
  targets: GsapSnapshotTarget[];
}

interface LiveTween {
  targets?: () => unknown[];
  vars?: unknown;
  startTime?: () => number;
  duration?: () => number;
  _from?: unknown;
  _initted?: unknown;
  _pt?: LivePropTween;
  timeline?: { getChildren?: () => LiveTween[] };
}
interface LivePropTween {
  p?: unknown;
  s?: unknown;
  c?: unknown;
  d?: { _pt?: LivePropTween };
  _next?: LivePropTween;
}
interface LiveGsap {
  getProperty?: (target: Element, prop: string) => unknown;
  defaults?: () => { ease?: unknown };
  globalTimeline?: {
    getChildren?: (nested: boolean, tweens: boolean, timelines: boolean) => LiveTween[];
  };
}
interface LiveTimeline {
  getChildren?: (nested: boolean) => LiveTween[];
  time?: () => number;
  vars?: { defaults?: { ease?: unknown } };
}
/** The frame globals this reads; typed here so the file also compiles where the runtime's are not. */
interface FrameGlobals {
  gsap?: LiveGsap;
  __timelines?: Record<string, LiveTimeline | undefined>;
  __player?: { getTime?: () => number };
  __hfWaitForSeekCompletion?: () => Promise<unknown>;
}

const VARS_SKIP = new Set([
  "ease",
  "easeEach",
  "duration",
  "delay",
  "stagger",
  "overwrite",
  "data",
  "id",
]);

class SnapshotBound extends Error {
  constructor(what: string) {
    super(`the preview's GSAP state is past the snapshot bound on ${what}`);
  }
}

/** Every text the snapshot carries, keys and ids included, is held to the text bound. */
function capped(value: string): string {
  if (value.length > MAX_SNAPSHOT_TEXT) throw new SnapshotBound("text length");
  return value;
}
const text = (value: unknown) => (typeof value === "string" ? capped(value) : null);
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Every tween on the frame's timelines, after any seek in flight has painted. Throws past a bound. */
export async function gsapSnapshot(): Promise<GsapSnapshot> {
  const frame = window as unknown as FrameGlobals;
  await frame.__hfWaitForSeekCompletion?.();
  const gsap = frame.gsap;
  const reader = new SnapshotReader();
  const timelines: GsapSnapshotTimeline[] = [];
  const held = new Set<LiveTween>();
  for (const [id, live] of Object.entries(frame.__timelines ?? {})) {
    if (typeof live?.getChildren !== "function") continue;
    const tweens = live.getChildren(true).filter((child) => typeof child.targets === "function");
    for (const tween of tweens) held.add(tween);
    if (timelines.length >= MAX_SNAPSHOT_TWEENS) throw new SnapshotBound("timelines");
    reader.spend(TIMELINE_FIELDS);
    timelines.push({
      id: capped(id),
      time: typeof live.time === "function" ? finite(live.time()) : null,
      defaultEase: text(live.vars?.defaults?.ease),
      tweens: tweens.map((tween) => reader.tween(tween)),
    });
  }
  const globalTweens = (gsap?.globalTimeline?.getChildren?.(true, true, false) ?? [])
    .filter((child) => typeof child.targets === "function" && !held.has(child))
    .map((tween) => reader.tween(tween));
  const time = frame.__player?.getTime?.();
  return {
    time: typeof time === "number" && Number.isFinite(time) ? time : null,
    defaultEase: text(gsap?.defaults?.().ease),
    timelines,
    globalTweens,
    targets: reader.targets(gsap),
  };
}

class SnapshotReader {
  private tweens = 0;
  private fields = 0;
  private channels = new Map<Element, Set<string>>();

  tween(live: LiveTween): GsapSnapshotTween {
    if (++this.tweens > MAX_SNAPSHOT_TWEENS) throw new SnapshotBound("tweens");
    const elements = (live.targets?.() ?? []).filter(isElementNode);
    this.spend(elements.length);
    const vars = this.plain(live.vars, 0);
    const parsed = parsedChannels(live._pt);
    const parts = (live.timeline?.getChildren?.() ?? []).map((part) => this.tween(part));
    for (const element of elements) this.note(element, vars, parsed, parts);
    const record = isPlainRecord(vars) ? (vars as Record<string, SnapshotValue>) : {};
    return { targets: elements.map(handleFor), vars: record, ...timing(live), parsed, parts };
  }

  targets(gsap: LiveGsap | undefined): GsapSnapshotTarget[] {
    if (this.channels.size > MAX_SNAPSHOT_TARGETS) throw new SnapshotBound("targets");
    return [...this.channels].map(([element, channels]) => {
      if (channels.size > MAX_SNAPSHOT_CHANNELS) throw new SnapshotBound("channels");
      this.spend(TARGET_FIELDS + channels.size);
      const values: Record<string, number> = {};
      const read = (channel: string) => {
        if (isElementMethod(element, channel)) return;
        const value = Number(gsap?.getProperty?.(element, channel));
        if (Number.isFinite(value)) values[channel] = value;
      };
      const gsapOwnsPosition =
        rendersTransform(element) || MOVES.some((channel) => channels.has(channel));
      withoutGsapTakeover(element, () => {
        for (const channel of channels) read(channel);
        if (gsapOwnsPosition) for (const axis of ["x", "y"]) if (!(axis in values)) read(axis);
      });
      const className = element.getAttribute("class") ?? "";
      if (className.length > MAX_SNAPSHOT_TEXT) throw new SnapshotBound("class names");
      return { handle: handleFor(element), id: capped(element.id), className, values };
    });
  }

  private note(
    element: Element,
    vars: SnapshotValue | undefined,
    parsed: GsapSnapshotTween["parsed"],
    parts: GsapSnapshotTween[],
  ) {
    const channels = this.channels.get(element) ?? new Set<string>();
    this.channels.set(element, channels);
    const steps = isPlainRecord(vars) ? [vars, ...stepsOf(vars.keyframes)] : [];
    for (const step of steps)
      for (const [key, value] of Object.entries(step))
        if (!VARS_SKIP.has(key) && isChannelValue(value)) channels.add(key);
    for (const { p } of [...parsed, ...parts.flatMap((part) => part.parsed)]) channels.add(p);
  }

  spend(fields: number) {
    if ((this.fields += fields) > MAX_SNAPSHOT_FIELDS) throw new SnapshotBound("fields");
  }

  private plain(value: unknown, depth: number): SnapshotValue | undefined {
    this.spend(1);
    if (Array.isArray(value)) return this.list(value, depth);
    if (isLiteralRecord(value)) return this.record(value, depth);
    return scalar(value);
  }

  private list(value: unknown[], depth: number): SnapshotValue[] {
    nested(depth);
    return value.map((item) => this.plain(item, depth + 1) ?? null);
  }

  private record(value: Record<string, unknown>, depth: number): Record<string, SnapshotValue> {
    nested(depth);
    const out: Record<string, SnapshotValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const kept = this.plain(item, depth + 1);
      if (kept !== undefined) out[capped(key)] = kept;
    }
    return out;
  }
}

const isElementMethod = (element: Element, channel: string) =>
  typeof Reflect.get(element, channel) === "function";

function timing(live: LiveTween) {
  return {
    start: finite(live.startTime?.()),
    duration: finite(live.duration?.()),
    from: Boolean(live._from),
    initted: Boolean(live._initted),
  };
}

// GSAP puts live objects on a tween's vars (`parent` is its timeline), and they reach the whole graph.
const isLiteralRecord = (value: unknown): value is Record<string, unknown> =>
  isPlainRecord(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function nested(depth: number) {
  if (depth >= MAX_VARS_DEPTH) throw new SnapshotBound("nesting");
}

/** A value kept as is; functions, elements and other live objects are left out. */
function scalar(value: unknown): SnapshotValue | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string")
    return typeof value === "boolean" || value === null ? value : undefined;
  return capped(value);
}

/** A step's value, or an object-of-arrays keyframe's list of them. */
const isChannelValue = (value: SnapshotValue): boolean =>
  typeof value === "number" || typeof value === "string" || Array.isArray(value);

/** Keyframe steps in any of GSAP's forms; an object of arrays is its own one step. */
function stepsOf(keyframes: SnapshotValue | undefined): Record<string, SnapshotValue>[] {
  if (Array.isArray(keyframes)) return keyframes.filter(isPlainRecord) as never;
  if (!isPlainRecord(keyframes)) return [];
  return [keyframes, ...Object.values(keyframes).filter(isPlainRecord)] as never;
}

/** The tween's property tweens, CSSPlugin's nested ones included, in chain order; a node seen before ends a chain. */
function parsedChannels(
  first: LivePropTween | undefined,
  seen = new Set<LivePropTween>(),
): GsapSnapshotTween["parsed"] {
  const out: GsapSnapshotTween["parsed"] = [];
  for (let node = first; node && !seen.has(node); node = node._next) {
    seen.add(node);
    if (typeof node.p === "string" && typeof node.s === "number" && typeof node.c === "number")
      out.push({ p: capped(node.p), s: node.s, c: node.c });
    out.push(...parsedChannels(node.d?._pt, seen));
    if (out.length > MAX_SNAPSHOT_CHANNELS) throw new SnapshotBound("parsed channels");
  }
  return out;
}
