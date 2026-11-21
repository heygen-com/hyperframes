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

const MEDIA_HAVE_FUTURE_DATA = 3;
const MEDIA_NETWORK_NO_SOURCE = 3;

/** Whether a preview still waits on a `<video>`/`<audio>` that cannot play through, or a Lottie still loading. */
export function previewAssetsUnloaded(
  doc: Document,
  lotties: readonly unknown[] | undefined,
): boolean {
  for (const el of doc.querySelectorAll("video, audio")) {
    const media = el as HTMLMediaElement;
    if (
      !media.error &&
      media.networkState !== MEDIA_NETWORK_NO_SOURCE &&
      media.readyState < MEDIA_HAVE_FUTURE_DATA
    )
      return true;
  }
  return (lotties ?? []).some((anim) => !isLottieAnimationLoaded(anim));
}
