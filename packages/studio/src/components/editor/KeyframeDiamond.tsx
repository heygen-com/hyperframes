import { memo } from "react";

export type DiamondState = "active" | "inactive" | "ghost";

interface KeyframeDiamondProps {
  state: DiamondState;
  onClick: () => void;
  title?: string;
  size?: number;
}

// fallow-ignore-next-line complexity
export const KeyframeDiamond = memo(function KeyframeDiamond({
  state,
  onClick,
  title,
  size = 10,
}: KeyframeDiamondProps) {
  const isFilled = state === "active";
  const opacity = state === "ghost" ? 0.25 : state === "inactive" ? 0.6 : 1;
  const color = state === "active" ? "#3b82f6" : "#a3a3a3";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex-shrink-0 p-0.5 transition-opacity hover:opacity-100"
      style={{ color, opacity }}
      title={title}
    >
      <svg width={size} height={size} viewBox="0 0 10 10">
        <rect
          x="5"
          y="0.7"
          width="6"
          height="6"
          rx="1"
          transform="rotate(45 5 0.7)"
          fill={isFilled ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.2"
        />
      </svg>
    </button>
  );
});
