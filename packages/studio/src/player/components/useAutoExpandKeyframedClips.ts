import { useEffect, useRef } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../store/playerStore";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { useStudioShellContextOptional } from "../../contexts/StudioContext";
import { animationContributesLane } from "./TimelinePropertyLanes";

/**
 * Keyframed clips start expanded (AE/Figma default). Auto-expands each clip the
 * first time it contributes a lane — real keyframes OR a synthesizable flat tween
 * — tracked per-clip so a later user collapse sticks and never bounces back open
 * (and clips added later still auto-expand).
 */
export function useAutoExpandKeyframedClips(gsapAnimations: Map<string, GsapAnimation[]>): void {
  const expandClips = usePlayerStore((s) => s.expandClips);
  const projectId = useStudioShellContextOptional()?.projectId ?? null;
  const seen = useRef({ projectId, source: gsapAnimations, clips: new Set<string>() });
  useEffect(() => {
    if (!STUDIO_KEYFRAMES_ENABLED) return;
    if (seen.current.projectId !== projectId) {
      const sourceChanged = seen.current.source !== gsapAnimations;
      seen.current = { projectId, source: gsapAnimations, clips: new Set() };
      if (!sourceChanged) return;
    } else {
      seen.current.source = gsapAnimations;
    }
    const fresh: string[] = [];
    for (const [key, animations] of gsapAnimations) {
      if (seen.current.clips.has(key)) continue;
      if (animations.some(animationContributesLane)) fresh.push(key);
    }
    if (fresh.length === 0) return;
    for (const key of fresh) seen.current.clips.add(key);
    expandClips(fresh);
  }, [gsapAnimations, expandClips, projectId]);
}
