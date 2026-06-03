import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../player/store/playerStore";

function extractIdFromSelector(selector: string): string | null {
  const match = selector.match(/^#([\w-]+)/);
  return match ? match[1] : null;
}

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
 */
export function getAnimationsForElement(
  animations: GsapAnimation[],
  target: GsapElementTarget,
): GsapAnimation[] {
  const matchers = new Set<string>();
  if (target.id) matchers.add(`#${target.id}`);
  if (target.selector) matchers.add(target.selector);
  if (matchers.size === 0) return [];
  return animations.filter((a) =>
    a.targetSelector.split(",").some((part) => matchers.has(part.trim())),
  );
}

export async function fetchParsedAnimations(
  projectId: string,
  sourceFile: string,
): Promise<ParsedGsap | null> {
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/gsap-animations/${encodeURIComponent(sourceFile)}`,
    );
    return res.ok ? ((await res.json()) as ParsedGsap) : null;
  } catch {
    return null;
  }
}

export function useGsapAnimationsForElement(
  projectId: string | null,
  sourceFile: string,
  target: GsapElementTarget | null,
  version: number,
): {
  animations: GsapAnimation[];
  multipleTimelines: boolean;
  unsupportedTimelinePattern: boolean;
} {
  const [allAnimations, setAllAnimations] = useState<GsapAnimation[]>([]);
  const [multipleTimelines, setMultipleTimelines] = useState(false);
  const [unsupportedTimelinePattern, setUnsupportedTimelinePattern] = useState(false);
  const lastFetchKeyRef = useRef("");

  useEffect(() => {
    const fetchKey = `${projectId}:${sourceFile}:${version}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;

    if (!projectId) {
      setAllAnimations([]);
      setMultipleTimelines(false);
      setUnsupportedTimelinePattern(false);
      return;
    }

    let cancelled = false;
    fetchParsedAnimations(projectId, sourceFile).then((parsed) => {
      if (cancelled) return;
      if (!parsed) {
        setAllAnimations([]);
        setMultipleTimelines(false);
        setUnsupportedTimelinePattern(false);
        return;
      }
      setAllAnimations(parsed.animations);
      setMultipleTimelines(parsed.multipleTimelines === true);
      setUnsupportedTimelinePattern(parsed.unsupportedTimelinePattern === true);
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, sourceFile, version]);

  const targetId = target?.id ?? null;
  const targetSelector = target?.selector ?? null;
  const animations = useMemo(
    () =>
      targetId || targetSelector
        ? getAnimationsForElement(allAnimations, { id: targetId, selector: targetSelector })
        : [],
    [allAnimations, targetId, targetSelector],
  );

  // Populate keyframe cache for the selected element.
  // Key format must match timeline element keys: "sourceFile#domId".
  const elementId = target?.id ?? null;
  useEffect(() => {
    if (!elementId) return;
    const { setKeyframeCache } = usePlayerStore.getState();
    const withKeyframes = animations.find((a) => a.keyframes);
    setKeyframeCache(`${sourceFile}#${elementId}`, withKeyframes?.keyframes ?? undefined);
  }, [elementId, sourceFile, animations]);

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
): void {
  const lastFetchKeyRef = useRef("");

  useEffect(() => {
    const fetchKey = `kf-cache:${projectId}:${sourceFile}:${version}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;
    if (!projectId) return;

    let cancelled = false;
    fetchParsedAnimations(projectId, sourceFile).then((parsed) => {
      if (cancelled || !parsed) return;
      const { setKeyframeCache } = usePlayerStore.getState();
      for (const anim of parsed.animations) {
        if (!anim.keyframes) continue;
        const id = extractIdFromSelector(anim.targetSelector);
        if (id) setKeyframeCache(`${sourceFile}#${id}`, anim.keyframes);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [projectId, sourceFile, version]);
}
