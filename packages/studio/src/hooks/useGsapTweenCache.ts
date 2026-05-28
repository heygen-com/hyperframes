import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GsapAnimation, ParsedGsap } from "@hyperframes/core/gsap-parser";

function getAnimationsForElement(animations: GsapAnimation[], elementId: string): GsapAnimation[] {
  return animations.filter((a) => a.targetSelector === `#${elementId}`);
}

async function fetchParsedAnimations(
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
  elementId: string | null,
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

  const animations = useMemo(
    () => (elementId ? getAnimationsForElement(allAnimations, elementId) : []),
    [allAnimations, elementId],
  );

  return { animations, multipleTimelines, unsupportedTimelinePattern };
}

export function useGsapCacheVersion() {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return { version, bump };
}
