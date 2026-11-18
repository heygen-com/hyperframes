// A value-only edit patches its one live GSAP tween in place; anything it cannot place
// confidently returns false and the caller reloads. Studio runs it on a frame it can reach,
// a sealed frame on itself through the editing port.
import { applyAuthoredInlineOpacity, readStampedAuthoredOpacity } from "../../colorGrading";

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

/** The live tween on `selector`; `channels` keeps an {x,y} patch off a co-located rotation-only set. */
// fallow-ignore-next-line complexity
export function resolveTween(
  target: PatchTarget,
  selector: string,
  kind: "keyframe" | "set",
  compositionId?: string,
  channels?: string[],
): ResolvedTween | null {
  const timelines = target.timelines;
  if (!timelines) return null;
  const targetEl = target.document?.querySelector(selector) ?? null;
  if (!targetEl) return null;
  const tlIds = compositionId
    ? [compositionId]
    : Object.keys(timelines).filter((k) => typeof timelines[k]?.getChildren === "function");
  const wantChannels = channels && channels.length > 0 ? channels : null;

  let first: ResolvedTween | null = null;
  let channelMatch: ResolvedTween | null = null;
  for (const tlId of tlIds) {
    const timeline = timelines[tlId];
    if (!timeline?.getChildren) continue;
    const now = typeof timeline.time === "function" ? timeline.time() : null;
    for (const tween of timeline.getChildren(true)) {
      if (!tween.vars || !matchesElement(tween, targetEl)) continue;
      const dur = typeof tween.duration === "function" ? tween.duration() : 0;
      const isSet = !(dur > 0);
      if (kind === "set" ? !isSet : isSet) continue;
      if (wantChannels) {
        const carries =
          kind === "set"
            ? varsCarryChannel(tween.vars, wantChannels)
            : keyframeVarsCarryChannel(tween.vars, wantChannels);
        if (carries) channelMatch ??= { tween, timeline };
        else first ??= { tween, timeline };
        continue;
      }
      first ??= { tween, timeline };
      if (kind === "keyframe" && now != null) {
        const start = typeof tween.startTime === "function" ? tween.startTime() : 0;
        if (now >= start - 1e-3 && now <= start + dur + 1e-3) return { tween, timeline };
      }
    }
  }
  return channelMatch ?? first;
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

// fallow-ignore-next-line complexity
function rebuildKeyframeTween(tween: PatchableTween, pct: number, props: KeyframeStep): boolean {
  const vars = tween.vars;
  if (!vars || "motionPath" in vars) return false;
  const kf = vars.keyframes;
  if (!kf || typeof kf !== "object" || Array.isArray(kf)) return false;
  if (!Object.values(props).every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  const parent = tween.parent;
  const targets = tween.targets?.();
  if (!parent?.to || !targets || targets.length === 0) return false;
  if (typeof tween.startTime !== "function" || typeof tween.kill !== "function") return false;
  const next = mergeKeyframeStep(kf as Record<string, Record<string, number>>, pct, props);
  const position = tween.startTime();
  tween.kill();
  parent.to(targets, { ...vars, keyframes: next }, position);
  return true;
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

function applyChange(tween: PatchableTween, change: RuntimeTweenChange): boolean {
  if (change.kind === "set") return patchSet(tween, change.props);
  if (change.kind === "keyframes") return patchKeyframes(tween, change.keyframes);
  if (change.kind === "keyframe-rebuild")
    return rebuildKeyframeTween(tween, change.pct, change.props);
  return false;
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
): boolean {
  try {
    const kind = change.kind === "set" ? "set" : "keyframe";
    const resolved = resolveTween(target, selector, kind, compositionId, changeChannels(change));
    if (!resolved) return false;
    const { tween, timeline } = resolved;
    if (changeTouchesOpacity(change)) restoreAuthoredOpacityForCapture(tween);
    if (!applyChange(tween, change)) return false;
    // Only the edited tween: a timeline-wide invalidate re-captures every from() against
    // the grading engine's opacity-0 hide, and graded elements vanish.
    if (change.kind !== "keyframe-rebuild") tween.invalidate?.();
    if (!deferSeek) seekToCurrent(target, timeline);
    return true;
  } catch {
    return false;
  }
}

const MAX_PATCHES = 64;
const MAX_KEYFRAME_STEPS = 64;
const MAX_SELECTOR_LENGTH = 2_000;

export type PatchTweensParams = {
  patches: Array<{ selector: string; change: RuntimeTweenChange }>;
  seek: boolean;
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

function parseChange(value: unknown): RuntimeTweenChange | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value).sort().join();
  if ((value.kind === "set" || value.kind === "global-set") && keys === "kind,props") {
    const props = numericChannels(value.props);
    return props ? { kind: value.kind, props } : null;
  }
  if (value.kind === "keyframe-rebuild" && keys === "kind,pct,props") {
    const props = numericChannels(value.props);
    const pct = value.pct;
    const okPct = typeof pct === "number" && pct >= 0 && pct <= 100;
    return props && okPct ? { kind: "keyframe-rebuild", pct, props } : null;
  }
  if (value.kind === "keyframes" && keys === "keyframes,kind") {
    const steps = value.keyframes;
    if (!Array.isArray(steps) || steps.length === 0 || steps.length > MAX_KEYFRAME_STEPS)
      return null;
    const parsed = steps.map(numericChannels);
    return parsed.every(Boolean)
      ? { kind: "keyframes", keyframes: parsed as KeyframeStep[] }
      : null;
  }
  return null;
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

/** The frame patching its own timelines: every patch must land, and it renders once at the end. */
export function patchTweens({ patches, seek }: PatchTweensParams): { patched: boolean } {
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
  const missed = patches.find(({ selector, change }, index) => {
    const last = index === patches.length - 1;
    return change.kind === "global-set"
      ? applyGlobalSet(target, selector, change.props) === null
      : !patchTween(target, selector, change, undefined, !(seek && last));
  });
  return { patched: missed === undefined };
}
