import { useState, useRef, type CSSProperties } from "react";
import { useMountEffect } from "../hooks/useMountEffect";
import { type AgentModalAnchorPoint, clampNumber } from "../utils/studioHelpers";

function getAgentModalPositionStyle(
  anchorPoint: AgentModalAnchorPoint | null,
): CSSProperties | undefined {
  if (!anchorPoint || typeof window === "undefined") return undefined;

  const modalWidth = 480;
  const estimatedModalHeight = 270;
  const margin = 16;
  const left = clampNumber(
    anchorPoint.x,
    margin + modalWidth / 2,
    window.innerWidth - margin - modalWidth / 2,
  );
  const top = clampNumber(
    anchorPoint.y + 12,
    margin,
    window.innerHeight - margin - estimatedModalHeight,
  );

  return { left, top, transform: "translateX(-50%)" };
}

export function AskAgentModal({
  selectionLabel,
  anchorPoint = null,
  onSubmit,
  onClose,
}: {
  selectionLabel: string;
  anchorPoint?: AgentModalAnchorPoint | null;
  onSubmit: (instruction: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modalPositionStyle = getAgentModalPositionStyle(anchorPoint);

  useMountEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  });

  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value.trim());
  };

  return (
    <div
      className={
        anchorPoint
          ? "fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm"
          : "fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      }
      onClick={onClose}
    >
      <div
        className={`w-[480px] rounded-2xl border border-neutral-800 bg-neutral-950 shadow-2xl ${
          anchorPoint ? "fixed" : ""
        }`}
        style={modalPositionStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/60">
          <div>
            <h3 className="text-sm font-medium text-neutral-200">Ask agent</h3>
            <p className="text-xs text-neutral-500 mt-0.5">
              {selectionLabel.length > 50 ? `${selectionLabel.slice(0, 49)}…` : selectionLabel}
            </p>
          </div>
          <button
            className="p-1 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <textarea
            ref={inputRef}
            className="w-full h-24 px-3 py-2 rounded-lg border border-neutral-800 bg-neutral-900/60 text-sm text-neutral-200 placeholder-neutral-600 resize-none focus:outline-none focus:border-studio-accent/60 focus:ring-1 focus:ring-studio-accent/30"
            placeholder="Describe what you want to change…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
              if (e.key === "Escape") onClose();
            }}
          />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-800/60">
          <span className="text-[11px] text-neutral-600">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to copy
          </span>
          <button
            className="px-4 py-1.5 rounded-lg bg-studio-accent/90 text-xs font-medium text-neutral-950 hover:bg-studio-accent disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!value.trim()}
            onClick={handleSubmit}
          >
            Copy prompt
          </button>
        </div>
      </div>
    </div>
  );
}
