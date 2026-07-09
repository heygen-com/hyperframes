import { useEffect, useMemo, useState } from "react";
import type { AnimeJsAnimation, ParsedAnimeJs } from "@hyperframes/core/animejs-parser";
import { getAnimationsForElement, resolveTargetElement } from "./gsapAnimationTargeting";
import { adaptAnimeAnimation, type EditableAnimation } from "./animeAnimationAdapter";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isParsedAnimeJs(value: unknown): value is ParsedAnimeJs {
  return isRecord(value) && Array.isArray(value.animations);
}

export async function fetchParsedAnimeAnimations(
  projectId: string,
  sourceFile: string,
): Promise<ParsedAnimeJs | null> {
  try {
    const res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/animejs-animations/${encodeURIComponent(sourceFile)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const parsed: unknown = await res.json();
    return isParsedAnimeJs(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function useAnimeAnimationsForElement(
  projectId: string | null,
  sourceFile: string,
  target: { id?: string | null; selector?: string | null } | null,
  version: number,
  iframeRef?: React.RefObject<HTMLIFrameElement | null>,
): {
  animations: EditableAnimation[];
  rawAnimations: AnimeJsAnimation[];
  multipleTimelines: boolean;
  unsupportedTimelinePattern: boolean;
} {
  const [allAnimations, setAllAnimations] = useState<AnimeJsAnimation[]>([]);
  const [multipleTimelines, setMultipleTimelines] = useState(false);
  const [unsupportedTimelinePattern, setUnsupportedTimelinePattern] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setAllAnimations([]);
      setMultipleTimelines(false);
      setUnsupportedTimelinePattern(false);
      return;
    }
    let cancelled = false;
    fetchParsedAnimeAnimations(projectId, sourceFile).then((parsed) => {
      if (cancelled) return;
      if (!parsed) {
        setAllAnimations([]);
        setMultipleTimelines(false);
        setUnsupportedTimelinePattern(false);
        return;
      }
      setAllAnimations(parsed.animations.filter((animation) => animation.method !== "label"));
      setMultipleTimelines(parsed.multipleTimelines === true);
      setUnsupportedTimelinePattern(parsed.unsupportedTimelinePattern === true);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, sourceFile, version]);

  const targetId = target?.id ?? null;
  const targetSelector = target?.selector ?? null;
  // fallow-ignore-next-line code-duplication
  const rawAnimations = useMemo(() => {
    if (!targetId && !targetSelector) return [];
    const element = resolveTargetElement({ id: targetId, selector: targetSelector }, iframeRef);
    return getAnimationsForElement(
      allAnimations,
      { id: targetId, selector: targetSelector },
      element,
    );
  }, [allAnimations, iframeRef, targetId, targetSelector]);

  const animations = useMemo(
    () =>
      rawAnimations.map(adaptAnimeAnimation).filter((anim): anim is EditableAnimation => !!anim),
    [rawAnimations],
  );

  return { animations, rawAnimations, multipleTimelines, unsupportedTimelinePattern };
}
