/**
 * Helpers for reading/writing the GSAP keyframe cache in the player store.
 * Extracted from useGsapScriptCommits to keep file sizes under the 600-line limit.
 */
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore, type KeyframeCacheEntry } from "../player/store/playerStore";

export function updateKeyframeCacheFromParsed(
  animations: GsapAnimation[],
  targetPath: string,
  selectionId: string | undefined,
  mutation: Record<string, unknown>,
): void {
  const { setKeyframeCache, elements } = usePlayerStore.getState();
  const idsWithKeyframes = new Set<string>();
  const merged = new Map<string, KeyframeCacheEntry>();
  for (const anim of animations) {
    const id = anim.targetSelector.match(/^#([\w-]+)/)?.[1];
    if (!id || !anim.keyframes) continue;
    idsWithKeyframes.add(id);

    // Convert tween-relative percentages to clip-relative so diamonds
    // render at the correct position within the timeline clip.
    const tweenPos = anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
    const tweenDur = anim.duration ?? 1;
    const timelineEl = elements.find(
      (el) => el.domId === id || (el.key ?? el.id) === `${targetPath}#${id}`,
    );
    const elStart = timelineEl?.start ?? 0;
    const elDuration = timelineEl?.duration ?? 1;
    const clipKeyframes = anim.keyframes.keyframes.map((kf) => {
      const absTime = tweenPos + (kf.percentage / 100) * tweenDur;
      const clipPct =
        elDuration > 0 ? Math.round(((absTime - elStart) / elDuration) * 1000) / 10 : kf.percentage;
      return {
        ...kf,
        percentage: clipPct,
        tweenPercentage: kf.percentage,
        propertyGroup: anim.propertyGroup,
      };
    });

    const existing = merged.get(id);
    if (existing) {
      const byPct = new Map<number, (typeof existing.keyframes)[0]>();
      for (const kf of [...existing.keyframes, ...clipKeyframes]) {
        const prev = byPct.get(kf.percentage);
        if (prev) {
          prev.properties = { ...prev.properties, ...kf.properties };
          if (kf.ease) prev.ease = kf.ease;
        } else {
          byPct.set(kf.percentage, { ...kf, properties: { ...kf.properties } });
        }
      }
      existing.keyframes = Array.from(byPct.values()).sort((a, b) => a.percentage - b.percentage);
    } else {
      merged.set(id, { ...anim.keyframes, keyframes: clipKeyframes });
    }
  }
  for (const [id, entry] of merged) {
    setKeyframeCache(`${targetPath}#${id}`, entry);
    setKeyframeCache(id, entry);
    if (targetPath !== "index.html") setKeyframeCache(`index.html#${id}`, entry);
  }
  const targetId =
    (mutation as { targetSelector?: string }).targetSelector?.match(/^#([\w-]+)/)?.[1] ??
    selectionId;
  if (targetId && !idsWithKeyframes.has(targetId)) {
    setKeyframeCache(`${targetPath}#${targetId}`, undefined);
    if (targetPath !== "index.html") setKeyframeCache(`index.html#${targetId}`, undefined);
  }
}

function buildCacheKey(sourceFile: string, elementId: string): string {
  return `${sourceFile}#${elementId}`;
}

export function readKeyframeSnapshot(
  sourceFile: string,
  elementId: string | null | undefined,
): KeyframeCacheEntry | undefined {
  if (!elementId) return undefined;
  return usePlayerStore.getState().keyframeCache.get(buildCacheKey(sourceFile, elementId));
}

export function writeKeyframeCache(
  sourceFile: string,
  elementId: string | null | undefined,
  data: KeyframeCacheEntry | undefined,
): void {
  if (!elementId) return;
  usePlayerStore.getState().setKeyframeCache(buildCacheKey(sourceFile, elementId), data);
}
