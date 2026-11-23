// A value-only edit patches its one live GSAP tween in place; anything it cannot place
// confidently returns false and the caller reloads. Studio runs it on a frame it can reach,
// a sealed frame on itself through the editing port.
import { applyAuthoredInlineOpacity, readStampedAuthoredOpacity } from "../../colorGrading";
import { recordLiveSet, swapWaiting } from "./softReload";
import { drawDrafts, rebaseDrawnPosition } from "../editingDraft";
import { markRestingScenesForRedraw } from "../sceneRest";
import { redrawGsapTimelineAt } from "../adapters/gsap";
import type { RuntimeTimelineLike } from "../types";
import { parseDraftEnd, type EditingDraftEnd } from "../editingDraftEnd";

export interface SetPatchProps {
  x?: number;
  y?: number;
  rotation?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  z?: number;
  transformPerspective?: number;
  scaleX?: number;
  scaleY?: number;
  scale?: number;
  opacity?: number;
  width?: number;
  height?: number;
}

/** A single keyframe step's numeric channels (the GSAP array-keyframe form). */
export type KeyframeStep = Record<string, number>;

export type RuntimeTweenChange =
  | { kind: "set"; props: SetPatchProps }
  | { kind: "keyframes"; keyframes: KeyframeStep[] }
  // GSAP compiles object-form keyframes into sub-tweens at creation and ignores later
  // `vars.keyframes` mutations, so one step's edit rebuilds the tween at its position.
  | { kind: "keyframe-rebuild"; pct: number; props: KeyframeStep }
  // A base `gsap.set` lives off the timeline: the element is static on these channels.
  | { kind: "global-set"; props: SetPatchProps };

const SET_CHANNELS: Array<keyof SetPatchProps> = [
  "x",
  "y",
  "rotation",
  "rotationX",
  "rotationY",
  "rotationZ",
  "z",
  "transformPerspective",
  "scaleX",
  "scaleY",
  "scale",
  "opacity",
];
const PATCH_CHANNELS = new Set<string>([...SET_CHANNELS, "width", "height"]);

export interface PatchableTween {
  targets?: () => Element[];
  vars?: Record<string, unknown>;
  duration?: () => number;
  startTime?: () => number;
  invalidate?: () => unknown;
  kill?: () => void;
  parent?: PatchableTimeline;
}

export interface PatchableTimeline {
  getChildren?: (deep: boolean) => PatchableTween[];
  time?: () => number;
  to?: (targets: Element[], vars: Record<string, unknown>, position?: number) => unknown;
}

export interface PatchTarget {
  timelines: Record<string, PatchableTimeline> | null | undefined;
  document: Document | null | undefined;
  gsap: { set?: (target: Element, vars: Record<string, number>) => void } | null | undefined;
  player: { getTime?: () => number; seek?: (t: number) => void } | null | undefined;
}

export function matchesElement(tween: PatchableTween, el: Element): boolean {
  if (!tween.targets) return false;
  for (const t of tween.targets()) {
    if (t === el || (el.id && (t as Element).id === el.id)) return true;
  }
  return false;
}

function varsCarryChannel(vars: Record<string, unknown> | undefined, channels: string[]): boolean {
  if (!vars) return false;
  return channels.some((ch) => Object.prototype.hasOwnProperty.call(vars, ch));
}

/** Whether a keyframe tween's steps carry one of `channels`, in the object, array or object-of-arrays form. */
export function keyframeVarsCarryChannel(
  vars: Record<string, unknown> | undefined,
  channels: string[],
): boolean {
  const kf = vars?.keyframes;
  if (!kf || typeof kf !== "object") return false;
  if (!Array.isArray(kf) && channels.some((ch) => Object.prototype.hasOwnProperty.call(kf, ch)))
    return true;
  const steps = Array.isArray(kf) ? kf : Object.values(kf);
  return steps.some(
    (step) =>
      step != null &&
      typeof step === "object" &&
      channels.some((ch) => Object.prototype.hasOwnProperty.call(step, ch)),
  );
}

export interface ResolvedTween {
  tween: PatchableTween;
  timeline: PatchableTimeline;
}

const tweenDuration = (tween: PatchableTween) =>
  typeof tween.duration === "function" ? tween.duration() : 0;

const isKind = (tween: PatchableTween, kind: "keyframe" | "set") =>
  tweenDuration(tween) > 0 === (kind === "keyframe");

function playsNow(tween: PatchableTween, timeline: PatchableTimeline): boolean {
  if (typeof timeline.time !== "function") return false;
  const now = timeline.time();
  const start = typeof tween.startTime === "function" ? tween.startTime() : 0;
  return now >= start - 1e-3 && now <= start + tweenDuration(tween) + 1e-3;
}

const carriesChannels = (
  vars: Record<string, unknown>,
  kind: "keyframe" | "set",
  channels: string[],
) => (kind === "set" ? varsCarryChannel(vars, channels) : keyframeVarsCarryChannel(vars, channels));

type WalkableTimeline = PatchableTimeline & { getChildren: (deep: boolean) => PatchableTween[] };

function liveTimelines(
  timelines: Record<string, PatchableTimeline>,
  compositionId?: string,
): WalkableTimeline[] {
  const ids = compositionId ? [compositionId] : Object.keys(timelines);
  return ids
    .map((id) => timelines[id])
    .filter((tl): tl is WalkableTimeline => typeof tl?.getChildren === "function");
}

type Candidate = {
  tween: PatchableTween & { vars: Record<string, unknown> };
  timeline: WalkableTimeline;
};

function candidatesFor(
  target: PatchTarget,
  selector: string,
  kind: "keyframe" | "set",
  compositionId?: string,
): Candidate[] {
  const targetEl = target.timelines ? target.document?.querySelector(selector) : null;
  if (!target.timelines || !targetEl) return [];
  const found: Candidate[] = [];
  for (const timeline of liveTimelines(target.timelines, compositionId))
    for (const tween of timeline.getChildren(true))
      if (tween.vars && matchesElement(tween, targetEl) && isKind(tween, kind))
        found.push({ tween: tween as Candidate["tween"], timeline });
  return found;
}

/** The live tween on `selector`; `channels` keeps an {x,y} patch off a co-located rotation-only set. */
export function resolveTween(
  target: PatchTarget,
  selector: string,
  kind: "keyframe" | "set",
  compositionId?: string,
  channels?: string[],
): ResolvedTween | null {
  const found = candidatesFor(target, selector, kind, compositionId);
  const preferred =
    channels && channels.length > 0
      ? found.find(({ tween }) => carriesChannels(tween.vars, kind, channels))
      : kind === "keyframe"
        ? found.find(({ tween, timeline }) => playsNow(tween, timeline))
        : undefined;
  return preferred ?? found[0] ?? null;
}

function finiteNumericProps(props: SetPatchProps): Record<string, number> | null {
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    numeric[k] = v;
  }
  return Object.keys(numeric).length > 0 ? numeric : null;
}

/** The element a base `gsap.set` was applied to, or null when it could not be applied. */
export function applyGlobalSet(
  target: PatchTarget,
  selector: string,
  props: SetPatchProps,
): Element | null {
  const el = target.document?.querySelector(selector) ?? null;
  const numeric = finiteNumericProps(props);
  if (typeof target.gsap?.set !== "function" || !el || !numeric) return null;
  target.gsap.set(el, numeric);
  rebaseDrawnPosition(el, numeric);
  recordLiveSet(el, numeric);
  return el;
}

function keyframesAreStatic(keyframes: KeyframeStep[]): boolean {
  if (keyframes.length === 0) return false;
  return keyframes.every(
    (step) =>
      !!step &&
      typeof step === "object" &&
      Object.values(step).every((v) => typeof v === "number" && Number.isFinite(v)),
  );
}

function patchSet(tween: PatchableTween, props: SetPatchProps): boolean {
  const vars = tween.vars;
  if (!vars || "motionPath" in vars) return false;
  let touched = false;
  for (const ch of SET_CHANNELS) {
    const next = props[ch];
    if (next === undefined) continue;
    if (typeof next !== "number" || !Number.isFinite(next)) return false;
    // A string here is a computed GSAP expression ("+=100"); a number would drop it.
    if (typeof vars[ch] === "string") return false;
    vars[ch] = next;
    touched = true;
  }
  return touched;
}

function patchKeyframes(tween: PatchableTween, keyframes: KeyframeStep[]): boolean {
  const vars = tween.vars;
  if (!vars || "motionPath" in vars) return false;
  if (!Array.isArray(vars.keyframes) || !keyframesAreStatic(keyframes)) return false;
  vars.keyframes = keyframes.map((step) => ({ ...step }));
  return true;
}

function mergeKeyframeStep(
  map: Record<string, Record<string, number>>,
  pct: number,
  props: KeyframeStep,
): Record<string, Record<string, number>> {
  const next: Record<string, Record<string, number>> = {};
  for (const [k, step] of Object.entries(map)) next[k] = { ...step };
  let key: string | null = null;
  for (const k of Object.keys(next)) {
    const n = parseFloat(k);
    if (Number.isFinite(n) && Math.abs(n - pct) < 0.05) {
      key = k;
      break;
    }
  }
  key ??= `${pct}%`;
  next[key] = { ...(next[key] ?? {}), ...props };
  return next;
}

type ReplaceableTween = PatchableTween & {
  vars: Record<string, unknown>;
  startTime: () => number;
  kill: () => void;
  parent: PatchableTimeline & { to: NonNullable<PatchableTimeline["to"]> };
};

const replaceable = (tween: PatchableTween): tween is ReplaceableTween =>
  !!tween.vars &&
  typeof tween.startTime === "function" &&
  typeof tween.kill === "function" &&
  typeof tween.parent?.to === "function";

function keyframeObject(
  vars: Record<string, unknown>,
): Record<string, Record<string, number>> | null {
  const kf = vars.keyframes;
  if ("motionPath" in vars || !kf || typeof kf !== "object" || Array.isArray(kf)) return null;
  return kf as Record<string, Record<string, number>>;
}

const finiteStep = (props: KeyframeStep) =>
  Object.values(props).every((v) => typeof v === "number" && Number.isFinite(v));

function rebuildKeyframeTween(
  tween: PatchableTween,
  pct: number,
  props: KeyframeStep,
): PatchableTween | null {
  if (!replaceable(tween) || !finiteStep(props)) return null;
  const kf = keyframeObject(tween.vars);
  const targets = tween.targets?.();
  if (!kf || !targets || targets.length === 0) return null;
  const next = mergeKeyframeStep(kf, pct, props);
  const position = tween.startTime();
  const parent = tween.parent;
  tween.kill();
  const before = new Set(parent.getChildren?.(false));
  parent.to(targets, { ...tween.vars, keyframes: next }, position);
  return parent.getChildren?.(false).find((child) => !before.has(child)) ?? null;
}

function changeChannels(change: RuntimeTweenChange): string[] | undefined {
  if (change.kind === "set")
    return Object.keys(change.props).filter(
      (k) => change.props[k as keyof SetPatchProps] !== undefined,
    );
  if (change.kind === "keyframe-rebuild") return Object.keys(change.props);
  return undefined;
}

function changeTouchesOpacity(change: RuntimeTweenChange): boolean {
  if (change.kind === "set" || change.kind === "global-set")
    return change.props.opacity !== undefined;
  if (change.kind === "keyframes") return change.keyframes.some((step) => "opacity" in step);
  return "opacity" in change.props;
}

/** A re-init captures the current inline opacity, which mid-grade is the engine's 0 hide. */
function restoreAuthoredOpacityForCapture(tween: PatchableTween): void {
  for (const target of tween.targets?.() ?? []) {
    const el = target as HTMLElement | null;
    if (!el?.style || typeof el.getAttribute !== "function") continue;
    const authored = readStampedAuthoredOpacity(el);
    if (authored !== null) applyAuthoredInlineOpacity(el.style, authored);
  }
}

function applyChange(tween: PatchableTween, change: RuntimeTweenChange): PatchableTween | null {
  if (change.kind === "set") return patchSet(tween, change.props) ? tween : null;
  if (change.kind === "keyframes") return patchKeyframes(tween, change.keyframes) ? tween : null;
  if (change.kind === "keyframe-rebuild")
    return rebuildKeyframeTween(tween, change.pct, change.props);
  return null;
}

type GsapInitFlag = { _initted?: unknown };

/** Reads GSAP's internal `_initted`: invalidate() clears it and the tween's next render sets it. */
const renderedOnceReached = (tween: PatchableTween): boolean => {
  const now = tween.parent?.time?.();
  const reached = typeof now === "number" && now >= (tween.startTime?.() ?? 0);
  return !reached || Boolean((tween as GsapInitFlag)._initted);
};

function drawWhatTheSeekLeft(tweens: readonly PatchableTween[]): void {
  for (const tween of tweens) {
    const parent = tween.parent as RuntimeTimelineLike | undefined;
    const time = parent?.totalTime?.();
    if (parent && typeof time === "number" && !renderedOnceReached(tween))
      redrawGsapTimelineAt(parent, time);
  }
}

function timelinesAbove(tween: PatchableTween): object[] {
  const chain: object[] = [];
  for (let parent = tween.parent; parent; parent = (parent as PatchableTween).parent)
    chain.push(parent);
  return chain;
}

function seekToCurrent(target: PatchTarget, timeline: PatchableTimeline): void {
  const player = target.player;
  const currentTime =
    typeof player?.getTime === "function"
      ? player.getTime()
      : typeof timeline.time === "function"
        ? timeline.time()
        : 0;
  player?.seek?.(Number.isFinite(currentTime) ? currentTime : 0);
}

/** `deferSeek`: a group commit renders once after its last patch, or queued members repaint stale. */
export function patchTween(
  target: PatchTarget,
  selector: string,
  change: Exclude<RuntimeTweenChange, { kind: "global-set" }>,
  compositionId?: string,
  deferSeek = false,
  patchedTweens: PatchableTween[] = [],
): boolean {
  try {
    const kind = change.kind === "set" ? "set" : "keyframe";
    const resolved = resolveTween(target, selector, kind, compositionId, changeChannels(change));
    if (!resolved) return false;
    const { tween, timeline } = resolved;
    if (changeTouchesOpacity(change)) restoreAuthoredOpacityForCapture(tween);
    const patched = applyChange(tween, change);
    if (!patched) return false;
    patchedTweens.push(patched);
    // Only the edited tween: a timeline-wide invalidate re-captures every from() against
    // the grading engine's opacity-0 hide, and graded elements vanish.
    if (change.kind !== "keyframe-rebuild") tween.invalidate?.();
    markRestingScenesForRedraw(timelinesAbove(patched));
    if (!deferSeek) seekToCurrent(target, timeline);
    return true;
  } catch {
    return false;
  }
}

const MAX_PATCHES = 64;
const MAX_KEYFRAME_STEPS = 64;
const MAX_SELECTOR_LENGTH = 2_000;

/** A base value never renders, so a batch renders on its last tween patch, whatever follows it. */
export function lastTweenPatch(patches: ReadonlyArray<{ change: RuntimeTweenChange }>): number {
  for (let i = patches.length - 1; i >= 0; i--)
    if (patches[i]!.change.kind !== "global-set") return i;
  return -1;
}

export type PatchTweensParams = {
  patches: Array<{ selector: string; change: RuntimeTweenChange }>;
  seek: boolean;
  endsDrafts?: EditingDraftEnd[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

function numericChannels(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  const ok = entries.every(
    ([k, v]) => PATCH_CHANNELS.has(k) && typeof v === "number" && Number.isFinite(v),
  );
  return ok && entries.length > 0 ? (value as Record<string, number>) : null;
}

const CHANGE_KEYS: Record<RuntimeTweenChange["kind"], string> = {
  set: "kind,props",
  "global-set": "kind,props",
  "keyframe-rebuild": "kind,pct,props",
  keyframes: "keyframes,kind",
};

function parseKeyframes(steps: unknown): RuntimeTweenChange | null {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_KEYFRAME_STEPS) return null;
  const parsed = steps.map(numericChannels);
  return parsed.every(Boolean) ? { kind: "keyframes", keyframes: parsed as KeyframeStep[] } : null;
}

function parseRebuild(pct: unknown, value: unknown): RuntimeTweenChange | null {
  const props = numericChannels(value);
  const okPct = typeof pct === "number" && pct >= 0 && pct <= 100;
  return props && okPct ? { kind: "keyframe-rebuild", pct, props } : null;
}

function parseChange(value: unknown): RuntimeTweenChange | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  const kind = value.kind as RuntimeTweenChange["kind"];
  // An unknown kind, prototype names included, has no key list here, so it fails this match.
  if (Object.keys(value).sort().join() !== CHANGE_KEYS[kind]) return null;
  if (kind === "keyframes") return parseKeyframes(value.keyframes);
  if (kind === "keyframe-rebuild") return parseRebuild(value.pct, value.props);
  const props = numericChannels(value.props);
  return props ? { kind, props } : null;
}

function parseEnds(value: unknown): EditingDraftEnd[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PATCHES) return null;
  const ends = value.map(parseDraftEnd);
  return ends.includes(null) ? null : (ends as EditingDraftEnd[]);
}

export function parsePatchTweens(params: unknown): PatchTweensParams | null {
  if (!isRecord(params) || Object.keys(params).sort().join() !== "patches,seek") return null;
  const { patches, seek } = params;
  if (typeof seek !== "boolean" || !Array.isArray(patches)) return null;
  if (patches.length === 0 || patches.length > MAX_PATCHES) return null;
  const parsed: PatchTweensParams["patches"] = [];
  for (const patch of patches) {
    if (!isRecord(patch) || Object.keys(patch).sort().join() !== "change,selector") return null;
    const { selector } = patch;
    const change = parseChange(patch.change);
    const okSelector =
      typeof selector === "string" && selector.length > 0 && selector.length <= MAX_SELECTOR_LENGTH;
    if (!okSelector || !change) return null;
    parsed.push({ selector, change });
  }
  return { patches: parsed, seek };
}

export function parsePatchTweensRequest(params: unknown): PatchTweensParams | null {
  if (!isRecord(params)) return null;
  const { endsDrafts, ...rest } = params;
  const parsed = parsePatchTweens(rest);
  const ends = parseEnds(endsDrafts);
  if (!parsed || !ends) return null;
  return ends.length ? { ...parsed, endsDrafts: ends } : parsed;
}

/** The frame patching its own timelines: every patch must land, and it renders once at the end. */
export function patchTweens({ patches, seek, endsDrafts }: PatchTweensParams): {
  patched: boolean;
} {
  const win = window as unknown as {
    __timelines?: Record<string, PatchableTimeline>;
    gsap?: PatchTarget["gsap"];
    __player?: PatchTarget["player"];
  };
  const target: PatchTarget = {
    timelines: win.__timelines,
    document,
    gsap: win.gsap,
    player: win.__player,
  };
  if (swapWaiting()) return { patched: false };
  const renderAt = lastTweenPatch(patches);
  const patchedTweens: PatchableTween[] = [];
  const missed = patches.find(({ selector, change }, index) => {
    if (change.kind === "global-set")
      return applyGlobalSet(target, selector, change.props) === null;
    const defer = !(seek && index === renderAt);
    return !patchTween(target, selector, change, undefined, defer, patchedTweens);
  });
  if (seek) drawWhatTheSeekLeft(patchedTweens);
  const shown = !seek || patchedTweens.every(renderedOnceReached);
  const patched = missed === undefined && shown;
  if (patched && endsDrafts) drawDrafts(endsDrafts);
  return { patched };
}
