// packages/core/src/slideshow/sceneId.ts

/**
 * Whether a composition id names a "scene-like" composition — i.e. a real slide
 * scene, not the root timeline (`main`) or a non-scene overlay (captions, ambient
 * layers). Shared by the runtime scene-window computation and the slideshow lint
 * rule so the two can never drift.
 */
export function isSceneLikeCompositionId(compositionId: string): boolean {
  const normalized = compositionId.trim().toLowerCase();
  if (!normalized || normalized === "main") return false;
  if (normalized.includes("caption")) return false;
  if (normalized.includes("ambient")) return false;
  return true;
}
