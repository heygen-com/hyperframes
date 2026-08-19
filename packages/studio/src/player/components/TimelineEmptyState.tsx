import type { DragEventHandler } from "react";
import { GUTTER, RULER_H } from "./timelineLayout";

interface TimelineEmptyStateProps {
  isDragOver: boolean;
  onFileDrop?: boolean;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
}

export function TimelineEmptyState({
  isDragOver,
  onFileDrop,
  onDragOver,
  onDragLeave,
  onDrop,
}: TimelineEmptyStateProps) {
  return (
    <div
      className={`h-full border-t bg-[#0a0a0b] flex flex-col select-none transition-colors duration-150 ${
        isDragOver ? "border-studio-accent/50 bg-studio-accent/[0.03]" : "border-neutral-800/50"
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Ruler */}
      <div
        className="flex-shrink-0 border-b border-neutral-800/40 flex items-end relative"
        style={{ height: RULER_H, paddingLeft: GUTTER }}
      >
        {[0, 10, 20, 30, 40, 50].map((s) => (
          <div
            key={s}
            className="flex flex-col items-center"
            style={{ position: "absolute", left: GUTTER + s * 14 }}
          >
            <span className="text-[9px] text-neutral-600 font-mono tabular-nums leading-none mb-0.5">
              {`${Math.floor(s / 60)
                .toString()
                .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`}
            </span>
            <div className="w-px h-[5px] bg-neutral-700/40" />
          </div>
        ))}
      </div>
      {/* Empty drop zone */}
      <div className="flex-1 flex items-center justify-center">
        <div
          className={`flex items-center gap-3 px-6 py-3 border border-dashed rounded-lg transition-colors duration-150 ${
            isDragOver ? "border-studio-accent/60 bg-studio-accent/[0.06]" : "border-neutral-700/50"
          }`}
        >
          {isDragOver ? (
            <>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-studio-accent flex-shrink-0"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="text-[13px] text-studio-accent">Drop media files to import</span>
            </>
          ) : (
            <>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-neutral-600 flex-shrink-0"
              >
                <rect x="2" y="2" width="20" height="20" rx="2" />
                <path d="M7 2v20" />
                <path d="M17 2v20" />
                <path d="M2 7h20" />
                <path d="M2 17h20" />
              </svg>
              <span className="text-[13px] text-neutral-500">
                {onFileDrop
                  ? "Drop media here or describe your video to start"
                  : "Describe your video to start creating"}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
