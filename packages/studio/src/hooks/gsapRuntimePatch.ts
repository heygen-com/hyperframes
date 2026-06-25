/**
 * Patch ONE tween's values in the preview iframe's runtime timeline in place, so a
 * value-only manual edit (a `tl.set` position/rotation/scale, or a keyframe
 * value/position change) is reflected INSTANTLY — without re-running the whole
 * composition.
 *
 * Defensive by default: the caller (`runCommit`) falls back to the existing soft
 * reload whenever this returns `false`. It returns `false` (never silently
 * mis-patches) when the tween can't be confidently located or the requested change
 * can't be safely expressed (dynamic/computed values, motionPath arcs, shape
 * mismatch), and never throws.
 *
 * "Which tween" is resolved by the same all-timelines scan `readRuntimeKeyframes`
 * uses (`resolveRuntimeTween`), so read and write agree on the target.
 */
import { resolveRuntimeTween, type RuntimeTween } from "./gsapRuntimeKeyframes";

/** Value-only channels a `tl.set(...)` patch may touch. */
export interface SetPatchProps {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  scale?: number;
  opacity?: number;
}

/** A single keyframe step's numeric channels (the GSAP array-keyframe form). */
export type KeyframeStep = Record<string, number>;

export type RuntimeTweenChange =
  | { kind: "set"; props: SetPatchProps }
  | { kind: "keyframes"; keyframes: KeyframeStep[] };

const SET_CHANNELS: Array<keyof SetPatchProps> = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "scale",
  "opacity",
];

type IframeWindow = Window & {
  __player?: { getTime?: () => number; seek?: (t: number) => void };
};

function playerOf(iframe: HTMLIFrameElement): IframeWindow["__player"] | null {
  try {
    return (iframe.contentWindow as IframeWindow | null)?.__player ?? null;
  } catch {
    return null;
  }
}

/** Every step value must be a finite number — string/computed values can't round-trip. */
function keyframesAreStatic(keyframes: KeyframeStep[]): boolean {
  if (keyframes.length === 0) return false;
  for (const step of keyframes) {
    if (!step || typeof step !== "object") return false;
    for (const v of Object.values(step)) {
      if (typeof v !== "number" || !Number.isFinite(v)) return false;
    }
  }
  return true;
}

function patchSet(tween: RuntimeTween, props: SetPatchProps): boolean {
  const vars = tween.vars;
  if (!vars) return false;
  // A `set` carrying a motionPath isn't a plain value set — defer.
  if ("motionPath" in vars) return false;
  let touched = false;
  for (const ch of SET_CHANNELS) {
    const next = props[ch];
    if (next === undefined) continue;
    if (typeof next !== "number" || !Number.isFinite(next)) return false;
    // A string value here is a dynamic/computed GSAP expression (e.g. "+=100",
    // "random(...)"). Overwriting it with a plain number would silently drop the
    // dynamic intent — decline so the caller soft-reloads from the (edited) source.
    if (typeof vars[ch] === "string") return false;
    vars[ch] = next;
    touched = true;
  }
  return touched;
}

function patchKeyframes(tween: RuntimeTween, keyframes: KeyframeStep[]): boolean {
  const vars = tween.vars;
  if (!vars) return false;
  // motionPath arc tweens express motion as a path, not channel keyframes — defer.
  if ("motionPath" in vars) return false;
  // Only the array-keyframe form is patched in place; the existing tween must
  // already carry array keyframes (shape match), or this is a structural change.
  if (!Array.isArray(vars.keyframes)) return false;
  if (!keyframesAreStatic(keyframes)) return false;
  vars.keyframes = keyframes.map((step) => ({ ...step }));
  return true;
}

/**
 * Update one tween's values in `window.__timelines` in place + re-seek to the
 * current playhead. Returns `true` on a confident patch, `false` otherwise
 * (caller falls back to a soft reload).
 */
export function patchRuntimeTweenInPlace(
  iframe: HTMLIFrameElement | null,
  selector: string,
  change: RuntimeTweenChange,
  compositionId?: string,
): boolean {
  if (!iframe) return false;
  try {
    // For a `set` patch, hand the resolver the channels actually being written so
    // it picks the set whose vars carry them — an element can have separate
    // {x,y} and {rotation} sets, and a position patch must not corrupt the
    // rotation set (channel-blind resolution would return the first match).
    const channels =
      change.kind === "set"
        ? Object.keys(change.props).filter(
            (k) => change.props[k as keyof SetPatchProps] !== undefined,
          )
        : undefined;
    const resolved = resolveRuntimeTween(
      iframe,
      selector,
      change.kind === "set" ? "set" : "keyframe",
      compositionId,
      channels,
    );
    if (!resolved) return false;
    const { tween, timeline } = resolved;

    const applied =
      change.kind === "set"
        ? patchSet(tween, change.props)
        : patchKeyframes(tween, change.keyframes);
    if (!applied) return false;

    // Recompute the tween (and its timeline) from the new vars, then re-render at
    // the current playhead. `invalidate()` makes GSAP re-read vars on the next render.
    tween.invalidate?.();
    timeline.invalidate?.();

    const player = playerOf(iframe);
    const currentTime =
      typeof player?.getTime === "function"
        ? player.getTime()
        : typeof timeline.time === "function"
          ? timeline.time()
          : 0;
    player?.seek?.(Number.isFinite(currentTime) ? currentTime : 0);
    return true;
  } catch {
    return false;
  }
}
