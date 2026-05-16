/**
 * Whether a registered Lottie animation has finished loading its JSON source.
 *
 * Handles both supported player shapes:
 * - `lottie-web` exposes a boolean `isLoaded` property on `AnimationItem`.
 * - `@dotlottie/player-component` doesn't have `isLoaded`; readiness is
 *   inferred from `totalFrames > 0` after manifest/animation JSON parsing.
 */
export function isLottieAnimationLoaded(anim: unknown): boolean {
  if (typeof anim !== "object" || anim === null) return true;
  const maybe = anim as { isLoaded?: boolean; totalFrames?: number };
  if (maybe.isLoaded === true) return true;
  if (typeof maybe.totalFrames === "number" && maybe.totalFrames > 0) return true;
  return false;
}
