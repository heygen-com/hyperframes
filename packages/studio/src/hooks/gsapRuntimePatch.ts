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

export type { RuntimeTweenChange, SetPatchProps } from "@hyperframes/core/runtime/patch-tween";

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
  } catch {
    return false;
  }
}
