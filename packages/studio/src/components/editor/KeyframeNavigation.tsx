import { memo } from "react";
import { KeyframeDiamond, type DiamondState } from "./KeyframeDiamond";

interface KeyframeNavigationProps {
  property: string;
  /** All keyframes for this element's tween, or null if no keyframes exist */
  keyframes: Array<{
    percentage: number;
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

  const handleDiamondClick = () => {
    if (diamondState === "ghost") {
      onConvertToKeyframes();
    } else if (diamondState === "active") {
      onRemoveKeyframe(currentPercentage);
    } else {
      onAddKeyframe(currentPercentage);
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
