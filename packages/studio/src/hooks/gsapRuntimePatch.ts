/**
 * Patch ONE tween's values in a reachable preview's runtime timeline in place, so a
 * value-only manual edit shows instantly. The caller (`runCommit`) soft-reloads
 * whenever this returns `false`. A sealed preview patches itself through the
 * editing port instead (`patch-tweens`).
 */
import {
  applyGlobalSet,
  patchTween,
  type PatchTarget,
  type RuntimeTweenChange,
} from "@hyperframes/core/runtime/patch-tween";
import { swapWaiting, type SoftReloadWindow } from "@hyperframes/core/runtime/soft-reload";
import { trackStudioEvent } from "../utils/studioTelemetry";

export type { RuntimeTweenChange, SetPatchProps } from "@hyperframes/core/runtime/patch-tween";

// A composition can name its own error class anything, so only these names leave the machine.
const REPORTED_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "EvalError",
  "URIError",
  "AggregateError",
  "SecurityError",
  "InvalidStateError",
  "NotFoundError",
  "DataCloneError",
]);
// The film controls the thrown value and its realm: read its name (never instanceof); a throwing name is 'other'.
function reportedErrorName(error: unknown): string {
  try {
    const name = (error as { name?: unknown } | null)?.name;
    return typeof name === "string" && REPORTED_ERROR_NAMES.has(name) ? name : "other";
  } catch {
    return "other";
  }
}

function reachablePreview(iframe: HTMLIFrameElement): PatchTarget {
  const win = iframe.contentWindow as
    | (Window & {
        __timelines?: PatchTarget["timelines"];
        gsap?: PatchTarget["gsap"];
        __player?: PatchTarget["player"];
      })
    | null;
  return {
    timelines: win?.__timelines,
    document: iframe.contentDocument,
    gsap: win?.gsap,
    player: win?.__player,
  };
}

/**
 * `true` on a confident patch, `false` otherwise. `deferSeek` skips the re-render
 * for a caller patching several tweens in a row that renders once after the last.
 */
export function patchRuntimeTweenInPlace(
  iframe: HTMLIFrameElement | null,
  selector: string,
  change: RuntimeTweenChange,
  compositionId?: string,
  deferSeek = false,
): boolean {
  if (!iframe) return false;
  try {
    if (iframe.contentWindow && swapWaiting(iframe.contentWindow as SoftReloadWindow)) return false;
    const target = reachablePreview(iframe);
    if (change.kind !== "global-set")
      return patchTween(target, selector, change, compositionId, deferSeek);
    return applyGlobalSet(target, selector, change.props) !== null;
  } catch (error) {
    trackStudioEvent("gsap_instant_patch_threw", {
      error_name: reportedErrorName(error),
    });
    console.error("[Studio] An in-place tween patch threw; reloading the preview instead", error);
    return false;
  }
}
