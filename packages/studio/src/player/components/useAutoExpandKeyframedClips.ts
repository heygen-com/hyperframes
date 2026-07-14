import { useEffect, useRef } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { usePlayerStore } from "../store/playerStore";
import { STUDIO_KEYFRAMES_ENABLED } from "../../components/editor/manualEditingAvailability";
import { animationContributesLane } from "./TimelinePropertyLanes";

/**
 * Keyframed clips start expanded (AE/Figma default). Auto-expands each clip the
 * first time it contributes a lane — real keyframes OR a synthesizable flat tween
 * — tracked per-clip so a later user collapse sticks and never bounces back open
 * (and clips added later still auto-expand).
 */
export function useAutoExpandKeyframedClips(gsapAnimations: Map<string, GsapAnimation[]>): void {
  const expandClips = usePlayerStore((s) => s.expandClips);
  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!STUDIO_KEYFRAMES_ENABLED) return;
    const fresh: string[] = [];
    for (const [key, animations] of gsapAnimations) {
      if (seen.current.has(key)) continue;
      if (animations.some(animationContributesLane)) fresh.push(key);
    }
    if (fresh.length === 0) return;
    for (const key of fresh) seen.current.add(key);
    expandClips(fresh);
  }, [gsapAnimations, expandClips]);
}
