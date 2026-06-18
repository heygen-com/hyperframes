import { memo } from "react";
import { KeyframeDiamond, type DiamondState } from "./KeyframeDiamond";

interface KeyframeNavigationProps {
  property: string;
  /** All keyframes for this element's tween, or null if no keyframes exist.
   *  `percentage` is clip-relative (element lifetime) for display/seek;
   *  `tweenPercentage` is the tween-relative value the writer/runtime key on. */
  keyframes: Array<{
    percentage: number;
    tweenPercentage?: number;
    properties: Record<string, number | string>;
    ease?: string;
  }> | null;
  /** Current playhead percentage within the element's lifetime (0-100) */
  currentPercentage: number;
  onSeek: (percentage: number) => void;
  onAddKeyframe: (percentage: number) => void;
  onRemoveKeyframe: (percentage: number) => void;
  onConvertToKeyframes: () => void;
}

const TOLERANCE = 0.5;

/**
 * Convert a clip-relative percentage (element lifetime, used for display/seek) to
 * the TWEEN-relative percentage the GSAP writer/runtime key on. The clip→tween
 * map is linear, recovered from the keyframes' own (percentage, tweenPercentage)
 * pairs. Falls back to the input when there's no usable mapping (e.g. parser
 * keyframes that are already tween-relative, or fewer than two anchors).
 */
export function clipToTweenPercentage(
  keyframes: ReadonlyArray<{ percentage: number; tweenPercentage?: number }>,
  clipPct: number,
): number {
  const mapped = keyframes.filter((kf) => typeof kf.tweenPercentage === "number");
  if (mapped.length < 2) return clipPct;
  const a = mapped[0]!;
  const b = mapped[mapped.length - 1]!;
  if (b.percentage === a.percentage) return a.tweenPercentage!;
  const slope = (b.tweenPercentage! - a.tweenPercentage!) / (b.percentage - a.percentage);
  return a.tweenPercentage! + (clipPct - a.percentage) * slope;
}

function ArrowLeft({ disabled }: { disabled: boolean }) {
  return (
    <svg
      width="6"
      height="10"
      viewBox="0 0 6 10"
      fill="none"
      style={{ opacity: disabled ? 0.25 : 1 }}
    >
      <path
        d="M5 1L1 5L5 9"
        stroke="#a3a3a3"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowRight({ disabled }: { disabled: boolean }) {
  return (
    <svg
      width="6"
      height="10"
      viewBox="0 0 6 10"
      fill="none"
      style={{ opacity: disabled ? 0.25 : 1 }}
    >
      <path
        d="M1 1L5 5L1 9"
        stroke="#a3a3a3"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// fallow-ignore-next-line complexity
export const KeyframeNavigation = memo(function KeyframeNavigation({
  property,
  keyframes,
  currentPercentage,
  onSeek,
  onAddKeyframe,
  onRemoveKeyframe,
  onConvertToKeyframes,
}: KeyframeNavigationProps) {
  // Find keyframes that contain this property
  const propertyKeyframes = keyframes?.filter((kf) => property in kf.properties) ?? [];

  const prevKf =
    propertyKeyframes.filter((kf) => kf.percentage < currentPercentage - TOLERANCE).at(-1) ?? null;

  const nextKf =
    propertyKeyframes.find((kf) => kf.percentage > currentPercentage + TOLERANCE) ?? null;

  const atCurrent =
    propertyKeyframes.find((kf) => Math.abs(kf.percentage - currentPercentage) <= TOLERANCE) ??
    null;

  // Diamond state
  let diamondState: DiamondState;
  if (!keyframes || keyframes.length === 0) {
    diamondState = "ghost";
  } else if (atCurrent) {
    diamondState = "active";
  } else if (propertyKeyframes.length > 0) {
    diamondState = "inactive";
  } else {
    diamondState = "ghost";
  }

  // Keyframe add/remove are keyed by TWEEN-relative percentage (what the GSAP
  // writer + runtime use), not the clip-relative `currentPercentage` used for
  // display/seek. Removing on an existing keyframe uses its own tweenPercentage;
  // adding converts the clip-relative playhead through the keyframes' own
  // clip→tween linear mapping. Passing clip-relative % made the mutation miss
  // every keyframe (off by the tween's offset/scale) → a silent no-op on disk
  // while the optimistic cache hid it, so the motion path never refreshed.
  const handleDiamondClick = () => {
    if (diamondState === "ghost") {
      onConvertToKeyframes();
    } else if (diamondState === "active" && atCurrent) {
      onRemoveKeyframe(atCurrent.tweenPercentage ?? atCurrent.percentage);
    } else {
      onAddKeyframe(clipToTweenPercentage(propertyKeyframes, currentPercentage));
    }
  };

  return (
    <div className="flex h-5 items-center gap-0.5">
      <button
        type="button"
        disabled={!prevKf}
        onClick={() => prevKf && onSeek(prevKf.percentage)}
        className="flex h-5 w-3 items-center justify-center disabled:cursor-default"
      >
        <ArrowLeft disabled={!prevKf} />
      </button>
      <KeyframeDiamond
        state={diamondState}
        onClick={handleDiamondClick}
        size={9}
        title={
          diamondState === "ghost"
            ? `Convert ${property} to keyframes`
            : diamondState === "active"
              ? `Remove ${property} keyframe`
              : `Add ${property} keyframe`
        }
      />
      <button
        type="button"
        disabled={!nextKf}
        onClick={() => nextKf && onSeek(nextKf.percentage)}
        className="flex h-5 w-3 items-center justify-center disabled:cursor-default"
      >
        <ArrowRight disabled={!nextKf} />
      </button>
    </div>
  );
});
