import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { GsapAnimation, GsapKeyframesData } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";
import { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeBridge";
import {
  clearKeyframeCacheForElement,
  clearKeyframeCacheForFile,
} from "./gsapKeyframeCacheHelpers";
import { toAbsoluteTime } from "./gsapShared";
import { deduplicateKeyframes, synthesizeFlatTweenKeyframes } from "./gsapTweenSynth";
import {
  getAnimationsForElement,
  resolveTargetElement,
  resolveSelectorElementIds,
  type GsapElementTarget,
} from "./gsapAnimationTargeting";
import { fetchParsedAnimations } from "./gsapParsedAnimations";

export {
  fetchParsedAnimations,
  getAnimationsForElement,
  resolveSelectorElementIds,
  type GsapElementTarget,
};

/**
 * Clip-relative timing basis for an element. Sub-composition internals (e.g. pills
 * inside a scene) aren't timeline clips themselves — they're derived at expand time
 * — so they're absent from `elements`. Without a basis, elDuration defaulted to 1
 * and clip-relative keyframe percentages blew past 100% (rendering off the clip).
 * Fall back to the sub-comp HOST's bounds, resolved via domClipChildren (the host's
 * data-composition-src is stripped in the rendered DOM, so we can't query it).
 */
export function resolveClipTimingBasis(
  elementId: string,
  sourceFile: string,
  elements: ReadonlyArray<{
    domId?: string;
    key?: string;
    id: string;
    start: number;
    duration: number;
  }>,
  domClipChildren: ReadonlyArray<{ id: string; hostId: string }>,
): { elStart: number; elDuration: number } {
  const direct = elements.find(
    (el) => el.domId === elementId || (el.key ?? el.id) === `${sourceFile}#${elementId}`,
  );
  if (direct) return { elStart: direct.start, elDuration: direct.duration };
  const hostId = domClipChildren.find((c) => c.id === elementId)?.hostId;
  const host = hostId
    ? elements.find((el) => el.domId === hostId || (el.key ?? el.id) === `index.html#${hostId}`)
    : undefined;
  return { elStart: host?.start ?? 0, elDuration: host?.duration ?? 1 };
}

export function useGsapAnimationsForElement(
  projectId: string | null,
  sourceFile: string,
  target: GsapElementTarget | null,
  version: number,
  iframeRef?: React.RefObject<HTMLIFrameElement | null>,
): {
  animations: GsapAnimation[];
  multipleTimelines: boolean;
  unsupportedTimelinePattern: boolean;
} {
  const [allAnimations, setAllAnimations] = useState<GsapAnimation[]>([]);
  const [multipleTimelines, setMultipleTimelines] = useState(false);
  const [unsupportedTimelinePattern, setUnsupportedTimelinePattern] = useState(false);
  const lastFetchKeyRef = useRef("");
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-run the per-element cache populate when sub-comp DOM children appear, so a
  // sub-comp element gets its host-relative keyframe percentages (not elDuration=1).
  const domClipChildrenKey = usePlayerStore((s) =>
    s.domClipChildren.map((c) => `${c.id}<${c.hostId}`).join("|"),
  );

  useEffect(() => {
    const targetKey = target?.id ?? target?.selector ?? "";
    const fetchKey = `${projectId}:${sourceFile}:${version}:${targetKey}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    if (!projectId) {
      setAllAnimations([]);
      setMultipleTimelines(false);
      setUnsupportedTimelinePattern(false);
      return;
    }

    let cancelled = false;
    fetchParsedAnimations(projectId, sourceFile).then((parsed) => {
      if (cancelled) {
        return;
      }
      if (!parsed) {
        setAllAnimations([]);
        setMultipleTimelines(false);
        setUnsupportedTimelinePattern(false);
        return;
      }
      setAllAnimations(parsed.animations);
      setMultipleTimelines(parsed.multipleTimelines === true);
      setUnsupportedTimelinePattern(parsed.unsupportedTimelinePattern === true);

      // Retry once if initial fetch returned 0 animations — handles
      // cold-load race where the sourceFile isn't resolved yet.
      if (parsed.animations.length === 0 && targetKey) {
        retryTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          fetchParsedAnimations(projectId, sourceFile).then((retryParsed) => {
            if (cancelled) return;
            if (retryParsed && retryParsed.animations.length > 0) {
              setAllAnimations(retryParsed.animations);
            }
          });
        }, 800);
      }
    });

    return () => {
      cancelled = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [projectId, sourceFile, version, target?.id, target?.selector]);

  const targetId = target?.id ?? null;
  const targetSelector = target?.selector ?? null;
  const rawAnimations = useMemo(() => {
    if (!targetId && !targetSelector) return [];
    // Resolve the live element so class / descendant tweens (e.g.
    // gsap.from(".dot", {stagger})) attribute to every matching element, not
    // just the one whose exact selector equals the tween's.
    const element = resolveTargetElement({ id: targetId, selector: targetSelector }, iframeRef);
    return getAnimationsForElement(
      allAnimations,
      { id: targetId, selector: targetSelector },
      element,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAnimations, targetId, targetSelector, version, iframeRef]);

  // fallow-ignore-next-line complexity
  const animations = useMemo(() => {
    const iframe = iframeRef?.current;
    let result = rawAnimations;

    // Enrich animations with unresolved keyframes from runtime
    if (iframe) {
      result = result.map((anim) => {
        if (!anim.hasUnresolvedKeyframes || anim.keyframes) return anim;
        const runtime = readRuntimeKeyframes(iframe, anim.targetSelector);
        if (!runtime) return anim;
        return {
          ...anim,
          keyframes: {
            format: "percentage" as const,
            keyframes: runtime.keyframes,
            ...(runtime.easeEach ? { easeEach: runtime.easeEach } : {}),
          },
          ...(runtime.arcPath ? { arcPath: runtime.arcPath } : {}),
        };
      });
    }

    // Match unresolved-selector animations from the parser to runtime tweens
    // targeting this element. This handles fully dynamic code (loop with variable selector).
    if (iframe && targetId && result.length === 0) {
      const unresolvedAnims = allAnimations.filter((a) => a.hasUnresolvedSelector);
      if (unresolvedAnims.length > 0) {
        const runtimeData = readRuntimeKeyframes(iframe, `#${targetId}`);
        if (runtimeData) {
          const scanned = scanAllRuntimeKeyframes(iframe);
          const runtimeEntry = scanned.get(targetId);
          if (runtimeEntry) {
            // Find which unresolved animation index matches this element
            // by correlating parser order with runtime tween order
            const runtimeIds = Array.from(scanned.keys());
            const runtimeIndex = runtimeIds.indexOf(targetId);
            const matchedAnim =
              runtimeIndex >= 0 && runtimeIndex < unresolvedAnims.length
                ? unresolvedAnims[runtimeIndex]
                : unresolvedAnims[0];
            if (matchedAnim) {
              result = [
                {
                  ...matchedAnim,
                  targetSelector: `#${targetId}`,
                  keyframes: {
                    format: "percentage" as const,
                    keyframes: runtimeEntry.keyframes,
                    ...(runtimeEntry.easeEach ? { easeEach: runtimeEntry.easeEach } : {}),
                  },
                  ...(runtimeEntry.arcPath ? { arcPath: runtimeEntry.arcPath } : {}),
                },
              ];
            }
          }
        }
      }
    }

    return result;
  }, [rawAnimations, allAnimations, iframeRef, targetId]);

  // Populate keyframe cache for the selected element.
  // Key format must match timeline element keys: "sourceFile#domId".
  // Merges keyframes from ALL animations targeting this element and synthesizes
  // flat tweens so the cache is never downgraded vs the bulk populate.
  const elementId = target?.id ?? null;
  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!elementId) return;

    // Resolve the element's time range from the player store so we can
    // convert tween-relative keyframe percentages to clip-relative ones.
    const { elements, domClipChildren } = usePlayerStore.getState();
    const { elStart, elDuration } = resolveClipTimingBasis(
      elementId,
      sourceFile,
      elements,
      domClipChildren,
    );

    const allKeyframes: Array<
      GsapKeyframesData["keyframes"][0] & { tweenPercentage?: number; propertyGroup?: string }
    > = [];
    let format: GsapKeyframesData["format"] = "percentage";
    let ease: string | undefined;
    let easeEach: string | undefined;
    for (const anim of animations) {
      // A static position hold (only x/y, no real motion) is a `set`, not a
      // keyframe — don't synthesize a diamond for it. Covers both `tl.set(...)`
      // and the `tl.to({ duration: 0, immediateRender: true })` hold that
      // remove-all-keyframes collapses to (which is otherwise shown as a stray
      // 0% keyframe).
      if (
        !anim.keyframes &&
        Object.keys(anim.properties).length > 0 &&
        Object.keys(anim.properties).every((k) => k === "x" || k === "y") &&
        (anim.method === "set" || (anim.duration ?? 0) === 0)
      )
        continue;
      const kf = anim.keyframes ?? synthesizeFlatTweenKeyframes(anim);
      if (!kf) continue;
      // Convert tween-relative percentages to clip-relative so diamonds
      // render at the correct position within the timeline clip.
      const tweenPos =
        anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
      const tweenDur = anim.duration ?? elDuration;
      for (const k of kf.keyframes) {
        const absTime = toAbsoluteTime(tweenPos, tweenDur, k.percentage);
        // 0.001% precision (was 0.1%) so a beat-snapped keyframe centers exactly
        // on the beat dot, which is rendered at the true beat time.
        const clipPct =
          elDuration > 0
            ? Math.round(((absTime - elStart) / elDuration) * 100000) / 1000
            : k.percentage;
        allKeyframes.push({
          ...k,
          percentage: clipPct,
          tweenPercentage: k.percentage,
          propertyGroup: anim.propertyGroup,
        });
      }
      format = kf.format;
      if (kf.ease) ease = kf.ease;
      if (kf.easeEach) easeEach = kf.easeEach;
    }
    if (allKeyframes.length === 0) {
      // The per-element parsed-animation match can transiently miss class /
      // selector tweens (e.g. `.dot`) that the file-wide populate or runtime
      // scan already cached. Only clear when no source cached this element —
      // otherwise selecting it would wipe its diamonds.
      const { keyframeCache } = usePlayerStore.getState();
      const hasCached =
        keyframeCache.has(`${sourceFile}#${elementId}`) || keyframeCache.has(elementId);
      if (!hasCached) clearKeyframeCacheForElement(sourceFile, elementId);
      return;
    }
    const dedupedKeyframes = deduplicateKeyframes(allKeyframes);
    const merged: GsapKeyframesData = {
      format,
      keyframes: dedupedKeyframes,
      ...(ease ? { ease } : {}),
      ...(easeEach ? { easeEach } : {}),
    };
    const { setKeyframeCache } = usePlayerStore.getState();
    setKeyframeCache(`${sourceFile}#${elementId}`, merged);
    // PropertyPanel reads the cache by bare elementId (without sourceFile prefix),
    // so write a duplicate entry under the bare key for cross-component lookups.
    setKeyframeCache(elementId, merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId, sourceFile, animations, domClipChildrenKey]);

  return { animations, multipleTimelines, unsupportedTimelinePattern };
}

export function useGsapCacheVersion() {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return { version, bump };
}

/**
 * Fetch GSAP animations for a file and populate the keyframe cache for all
 * elements. Called from the Timeline component so diamonds show without
 * requiring a selection.
 */
export function usePopulateKeyframeCacheForFile(
  projectId: string | null,
  sourceFile: string,
  version: number,
  iframeRef?: React.RefObject<HTMLIFrameElement | null>,
): void {
  const elementCount = usePlayerStore((s) => s.elements.length);
  // Re-run when sub-comp DOM children appear (they supply the host bounds the
  // clip-relative keyframe percentages are computed against; without this the
  // cache is computed once before they exist and the percentages stay wrong).
  const domClipChildrenKey = usePlayerStore((s) =>
    s.domClipChildren.map((c) => `${c.id}<${c.hostId}`).join("|"),
  );
  const lastFetchKeyRef = useRef("");

  const runtimeScanDoneRef = useRef("");
  const astFetchDoneRef = useRef("");

  useEffect(() => {
    const fetchKey = `kf-cache:${projectId}:${sourceFile}:${version}:${elementCount}:${domClipChildrenKey}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;
    runtimeScanDoneRef.current = "";
    astFetchDoneRef.current = "";
    if (!projectId) return;

    const sf = sourceFile;
    // fallow-ignore-next-line complexity
    fetchParsedAnimations(projectId, sf).then((parsed) => {
      if (!parsed) return;
      const { setKeyframeCache } = usePlayerStore.getState();
      clearKeyframeCacheForFile(sf);
      const { elements, domClipChildren } = usePlayerStore.getState();
      const doc = iframeRef?.current?.contentDocument;
      const mergedByElement = new Map<string, GsapKeyframesData>();
      for (const anim of parsed.animations) {
        if (anim.hasUnresolvedKeyframes) continue;
        // Position-only static holds are not keyframed animations — skip them so
        // they don't draw a timeline diamond. Covers both a `tl.set(...)` and the
        // `tl.to({ duration: 0, immediateRender: true })` that remove-all-keyframes
        // collapses a keyframed tween to.
        if (!anim.keyframes && (anim.method === "set" || (anim.duration ?? 0) === 0)) {
          const propKeys = Object.keys(anim.properties).filter((k) => k !== "immediateRender");
          if (propKeys.length > 0 && propKeys.every((k) => k === "x" || k === "y")) {
            continue;
          }
        }
        const kfData = anim.keyframes ?? synthesizeFlatTweenKeyframes(anim);
        if (!kfData) continue;
        const tweenPos =
          anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
        const tweenDur = anim.duration ?? 1;
        // Attribute the tween to every element it animates (handles class /
        // group / descendant selectors, not just `#id`).
        for (const id of resolveSelectorElementIds(anim.targetSelector, doc)) {
          const { elStart, elDuration } = resolveClipTimingBasis(id, sf, elements, domClipChildren);
          const clipKeyframes = kfData.keyframes.map((kf) => {
            const absTime = toAbsoluteTime(tweenPos, tweenDur, kf.percentage);
            // 0.001% precision (matching useGsapAnimationsForElement above) so a
            // beat-snapped keyframe centers exactly on the beat dot and the two
            // caches agree on a keyframe's percentage.
            const clipPct =
              elDuration > 0
                ? Math.round(((absTime - elStart) / elDuration) * 100000) / 1000
                : kf.percentage;
            return {
              ...kf,
              percentage: clipPct,
              tweenPercentage: kf.percentage,
              propertyGroup: anim.propertyGroup,
            };
          });
          const existing = mergedByElement.get(id);
          if (existing) {
            existing.keyframes = deduplicateKeyframes([...existing.keyframes, ...clipKeyframes]);
          } else {
            mergedByElement.set(id, { ...kfData, keyframes: clipKeyframes });
          }
        }
      }
      for (const [id, kfData] of mergedByElement) {
        setKeyframeCache(`${sf}#${id}`, kfData);
        setKeyframeCache(id, kfData);
        if (sf !== "index.html") setKeyframeCache(`index.html#${id}`, kfData);
      }
      astFetchDoneRef.current = fetchKey;
    });
    // elementCount is in the deps because new timeline elements (e.g. after a
    // sub-composition expand) need their keyframe cache populated immediately;
    // without it the effect won't re-run when elements appear/disappear.
    // iframeRef is read for DOM selector resolution but intentionally not a dep
    // (it's a stable ref; the separate runtime-scan effect owns iframe timing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sourceFile, version, elementCount, domClipChildrenKey]);

  // Separate effect for runtime keyframe discovery — polls until the iframe
  // has loaded GSAP timelines, independent of the AST fetch lifecycle.
  useEffect(() => {
    if (!projectId) return;
    const sf = sourceFile;

    let attempts = 0;
    const maxAttempts = 10;

    // fallow-ignore-next-line complexity
    const tryRuntimeScan = () => {
      if (runtimeScanDoneRef.current === `kf-cache:${projectId}:${sf}:${version}`) return true;
      const iframe =
        iframeRef?.current ?? document.querySelector<HTMLIFrameElement>("iframe[src*='/preview/']");
      if (!iframe) return false;
      // Clip dims per element so the scan converts tween-relative keyframes to
      // clip-relative (matching the static path) instead of timeline-relative.
      const clipById = new Map<string, { start: number; duration: number }>();
      for (const el of usePlayerStore.getState().elements) {
        if (el.domId) clipById.set(el.domId, { start: el.start, duration: el.duration });
      }
      const scanned = scanAllRuntimeKeyframes(iframe, clipById);
      if (scanned.size === 0) return false;
      const { setKeyframeCache, keyframeCache } = usePlayerStore.getState();
      for (const [id, data] of scanned) {
        const cacheKey = `${sf}#${id}`;
        const fallbackKey = `index.html#${id}`;
        const alreadyCached =
          keyframeCache.has(cacheKey) || keyframeCache.has(fallbackKey) || keyframeCache.has(id);
        if (alreadyCached) continue;
        // Skip position-only set tweens from runtime too — same filter as AST path
        const isPosOnly =
          data.keyframes.length === 1 &&
          Object.keys(data.keyframes[0].properties).every((k) => k === "x" || k === "y");
        if (isPosOnly) {
          continue;
        }
        const entry = {
          format: "percentage" as const,
          keyframes: data.keyframes,
          ...(data.easeEach ? { easeEach: data.easeEach } : {}),
        };
        setKeyframeCache(cacheKey, entry);
        if (sf !== "index.html") setKeyframeCache(fallbackKey, entry);
        setKeyframeCache(id, entry);
      }
      runtimeScanDoneRef.current = `kf-cache:${projectId}:${sf}:${version}`;
      return true;
    };

    if (tryRuntimeScan()) return;

    const interval = setInterval(() => {
      attempts++;
      if (tryRuntimeScan() || attempts >= maxAttempts) clearInterval(interval);
    }, 500);

    return () => clearInterval(interval);
  }, [projectId, sourceFile, version, iframeRef]);
}
