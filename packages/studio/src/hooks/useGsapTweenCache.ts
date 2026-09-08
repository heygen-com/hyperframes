import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { GsapAnimation, GsapKeyframesData } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";
import { readRuntimeKeyframes, scanAllRuntimeKeyframes } from "./gsapRuntimeBridge";
import {
  clearKeyframeCacheForElement,
  elementCacheKeys,
  pruneKeyframeCacheToFiles,
  publishKeyframeCache,
  writeGsapAnimationsForElement,
} from "./gsapKeyframeCacheHelpers";
import { resolveClipTimingBasis, toAbsoluteTime, toClipPercentage } from "./gsapShared";
import {
  deduplicateKeyframes,
  isStaticPositionHold,
  synthesizeFlatTweenKeyframes,
  type MergeableKeyframe,
} from "./gsapTweenSynth";
import { fetchParsedAnimations, populateKeyframeCacheFromAst } from "./keyframeCacheAstLoad";

// Re-exported so callers keep importing the GSAP cache surface from one module.
export { resolveClipTimingBasis } from "./gsapShared";
export { fetchParsedAnimations, resolveSelectorElementIds } from "./keyframeCacheAstLoad";

/** The selected element's identity for matching tweens to it. */
export interface GsapElementTarget {
  id?: string | null;
  selector?: string | null;
}

/**
 * A tween belongs to the selected element when its target selector addresses
 * that element — by id (`#id`), by the exact CSS selector the element was
 * selected through (`.kicker`), or as one member of a group selector
 * (`.clock-face, .clock-hand`, emitted for array/`toArray` targets). Real
 * compositions target tweens by class via `querySelector`, so id-only matching
 * misses them.
 *
 * When the live DOM `element` is supplied, each comma-part of a tween's selector
 * is also tested with `element.matches(part)` — true CSS semantics — so a
 * class/descendant tween shared across elements (e.g. `gsap.from(".dot", {stagger})`)
 * is attributed to *every* matching element, not just the one whose exact
 * selector string happens to equal the tween's.
 */
export function getAnimationsForElement(
  animations: GsapAnimation[],
  target: GsapElementTarget,
  element?: Element | null,
): GsapAnimation[] {
  const matchers = new Set<string>();
  if (target.id) matchers.add(`#${target.id}`);
  if (target.selector) matchers.add(target.selector);
  if (matchers.size === 0 && !element) return [];
  return animations.filter((a) =>
    a.targetSelector.split(",").some((part) => {
      const trimmed = part.trim();
      if (!trimmed) return false;
      if (matchers.has(trimmed)) return true;
      const lastSimple = trimmed.split(/\s+/).pop();
      if (lastSimple && matchers.has(lastSimple)) return true;
      if (element) {
        try {
          if (element.matches(trimmed)) return true;
        } catch {
          /* tween selector isn't a valid CSS selector for matches() — skip */
        }
      }
      return false;
    }),
  );
}

export function useGsapAnimationsForElement(
  projectId: string | null,
  sourceFile: string,
  target: GsapElementTarget | null,
  version: number,
  // The element, not a ref to it. A ref read during render is a render side
  // effect: the React Compiler declines any hook that does it, and the two memos
  // below read the live preview DOM through this. The caller already holds the
  // same element as state, and passing it makes it a real dependency, so a
  // replaced iframe re-resolves instead of waiting for the next `version` bump.
  previewIframe?: HTMLIFrameElement | null,
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
  // The preview document, tagged with the composition generation that produced
  // it. A soft reload swaps the document inside the SAME iframe element, so the
  // element alone cannot say the DOM changed; `version` can. Carrying it in the
  // value makes it a real input to the resolution below instead of an extra name
  // on that dependency list, which is what needed suppressing before.
  const previewDocument = useMemo(
    () => ({ generation: version, doc: previewIframe?.contentDocument ?? null }),
    [previewIframe, version],
  );
  const rawAnimations = useMemo(() => {
    if (!targetId && !targetSelector) return [];
    // Resolve the live element so class / descendant tweens (e.g.
    // gsap.from(".dot", {stagger})) attribute to every matching element, not
    // just the one whose exact selector equals the tween's.
    let element: Element | null = null;
    const doc = previewDocument.doc;
    if (doc) {
      try {
        element =
          (targetId ? doc.getElementById(targetId) : null) ??
          (targetSelector ? doc.querySelector(targetSelector) : null);
      } catch {
        element = null;
      }
    }
    return getAnimationsForElement(
      allAnimations,
      { id: targetId, selector: targetSelector },
      element,
    );
  }, [allAnimations, targetId, targetSelector, previewDocument]);

  // fallow-ignore-next-line complexity
  const animations = useMemo(() => {
    const iframe = previewIframe ?? null;
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
  }, [rawAnimations, allAnimations, previewIframe, targetId]);

  // Populate keyframe cache for the selected element.
  // Key format must match timeline element keys: "sourceFile#domId".
  // Merges keyframes from ALL animations targeting this element and synthesizes
  // flat tweens so the cache is never downgraded vs the bulk populate.
  const elementId = target?.id ?? null;
  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!elementId) return;
    // Same admission rule as the keyframe cache below (hold skip included) and
    // no property-group filter: the two stores must agree, or a hold draws an
    // expanded property lane with no collapsed diamond behind it and an
    // ungrouped tween draws diamonds with no lane source.
    const sourceAnimations = animations.filter(
      (animation) =>
        !isStaticPositionHold(animation) &&
        (animation.keyframes || synthesizeFlatTweenKeyframes(animation)),
    );
    if (sourceAnimations.length > 0)
      writeGsapAnimationsForElement(sourceFile, elementId, sourceAnimations);

    // Resolve the element's time range from the player store so we can
    // convert tween-relative keyframe percentages to clip-relative ones.
    const { elements, domClipChildren } = usePlayerStore.getState();
    const { elStart, elDuration } = resolveClipTimingBasis(
      elementId,
      sourceFile,
      elements,
      domClipChildren,
    );

    const allKeyframes: MergeableKeyframe[] = [];
    let format: GsapKeyframesData["format"] = "percentage";
    let ease: string | undefined;
    let easeEach: string | undefined;
    for (const anim of animations) {
      if (isStaticPositionHold(anim)) continue;
      const kf = anim.keyframes ?? synthesizeFlatTweenKeyframes(anim);
      if (!kf) continue;
      // Convert tween-relative percentages to clip-relative so diamonds
      // render at the correct position within the timeline clip.
      const tweenPos =
        anim.resolvedStart ?? (typeof anim.position === "number" ? anim.position : 0);
      const tweenDur = anim.duration ?? elDuration;
      for (const k of kf.keyframes) {
        const absTime = toAbsoluteTime(tweenPos, tweenDur, k.percentage);
        const clipPct = toClipPercentage(absTime, elStart, elDuration, k.percentage);
        allKeyframes.push({
          ...k,
          percentage: clipPct,
          tweenPercentage: k.percentage,
          propertyGroup: anim.propertyGroup,
          animationId: anim.id,
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
      const hasCached = elementCacheKeys(sourceFile, elementId).some((key) =>
        keyframeCache.has(key),
      );
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
    // elementCacheKeys owns the key-variant list every writer sets (prefixed,
    // index.html fallback, bare id). Building it by hand here is what let this
    // site drift: it omitted the fallback key, and it wrote the bare id without
    // the string coercion that keeps prune from throwing on a non-string. All
    // keys land in one publish: a reader that woke between two separate writes
    // saw the prefixed key updated and the bare one still stale.
    publishKeyframeCache((draft) => {
      for (const key of elementCacheKeys(sourceFile, elementId)) {
        draft.keyframeCache.set(key, merged);
      }
    });
    // `domClipChildrenKey` is a trigger, not a value this body reads: the store
    // is read imperatively above, and the key is what says the sub-comp children
    // changed. It was suppressed to stand; a suppression is a bail-out the React
    // Compiler counts, and it cost this hook every memo in it.
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

/**
 * Run `attempt` now, then every `everyMs` until it reports done or `maxTries`
 * are spent. Returns the stop function an effect can hand back as its cleanup.
 *
 * Module scope, not the effect body: the retry counter has to be incremented
 * from inside the interval callback, and the React Compiler cannot lower `++` on
 * a variable a lambda captures. It declines the whole hook when it finds one.
 */
function pollUntilDone(attempt: () => boolean, everyMs: number, maxTries: number): () => void {
  if (attempt()) return () => {};
  let tries = 0;
  const interval = setInterval(() => {
    tries++;
    if (attempt() || tries >= maxTries) clearInterval(interval);
  }, everyMs);
  return () => clearInterval(interval);
}

export function usePopulateKeyframeCacheForFile(
  projectId: string | null,
  sourceFile: string,
  version: number,
  // The element, not a ref to it: a parameter ref's `.current` can never be a
  // true dependency, and the omission had to be suppressed to stand. A
  // suppression is a bail-out the React Compiler counts, and it cost this hook
  // every memo in it.
  previewIframe?: HTMLIFrameElement | null,
): void {
  const elementCount = usePlayerStore((s) => s.elements.length);
  // Every sub-composition file the timeline shows rows for. The cache is loaded
  // for all of them up front, so keyframe lanes are populated on open instead of
  // only once a clip from that file is selected (which is what switches
  // `sourceFile`). Only files reachable from the store's elements are covered;
  // a composition nested inside another still loads on first selection.
  const compositionSrcKey = usePlayerStore((s) =>
    Array.from(new Set(s.elements.map((el) => el.compositionSrc).filter((src) => !!src)))
      .sort()
      .join("|"),
  );
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
    const fetchKey = `kf-cache:${projectId}:${sourceFile}:${version}:${elementCount}:${domClipChildrenKey}:${compositionSrcKey}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;
    runtimeScanDoneRef.current = "";
    astFetchDoneRef.current = "";
    if (!projectId) return;

    // The active file first: it owns the selection, and each file clears only
    // its own cache entries, so the order just decides who writes the bare
    // `id` alias last.
    const files = Array.from(
      new Set([sourceFile, ...(compositionSrcKey ? compositionSrcKey.split("|") : [])]),
    );
    const doc = previewIframe?.contentDocument;
    // Everything the previous scan cached for a file this one no longer covers
    // (the composition just switched away from) has no owner left to clear it.
    pruneKeyframeCacheToFiles(files);
    Promise.all(files.map((sf) => populateKeyframeCacheFromAst(projectId, sf, doc))).then(() => {
      astFetchDoneRef.current = fetchKey;
    });
    // elementCount is in the deps because new timeline elements (e.g. after a
    // sub-composition expand) need their keyframe cache populated immediately;
    // without it the effect won't re-run when elements appear/disappear. A
    // replaced iframe re-enters here and leaves on the fetch-key guard above,
    // which is what it did before it was a dependency at all.
  }, [
    projectId,
    sourceFile,
    version,
    elementCount,
    domClipChildrenKey,
    compositionSrcKey,
    previewIframe,
  ]);

  // Separate effect for runtime keyframe discovery — polls until the iframe
  // has loaded GSAP timelines, independent of the AST fetch lifecycle.
  useEffect(() => {
    if (!projectId) return;
    const sf = sourceFile;

    // fallow-ignore-next-line complexity
    const tryRuntimeScan = () => {
      if (runtimeScanDoneRef.current === `kf-cache:${projectId}:${sf}:${version}`) return true;
      const iframe =
        previewIframe ?? document.querySelector<HTMLIFrameElement>("iframe[src*='/preview/']");
      if (!iframe) return false;
      // Clip dims per element so the scan converts tween-relative keyframes to
      // clip-relative (matching the static path) instead of timeline-relative.
      const clipById = new Map<string, { start: number; duration: number }>();
      for (const el of usePlayerStore.getState().elements) {
        if (el.domId) clipById.set(el.domId, { start: el.start, duration: el.duration });
      }
      const scanned = scanAllRuntimeKeyframes(iframe, clipById);
      if (scanned.size === 0) return false;
      // One publish for the whole scan: a scan of a 120-clip composition used to
      // emit up to three store notifications per element, and every subscriber
      // in between re-rendered against a cache only partly filled in.
      publishKeyframeCache((draft) => {
        for (const [id, data] of scanned) {
          const keys = elementCacheKeys(sf, id);
          if (keys.some((key) => draft.keyframeCache.has(key))) continue;
          // Skip position-only set tweens from runtime too, same filter as AST path
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
          for (const key of keys) draft.keyframeCache.set(key, entry);
        }
      });
      runtimeScanDoneRef.current = `kf-cache:${projectId}:${sf}:${version}`;
      return true;
    };

    return pollUntilDone(tryRuntimeScan, 500, 10);
  }, [projectId, sourceFile, version, previewIframe]);
}
