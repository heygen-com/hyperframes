import { type ReactNode } from "react";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import type { TrackVisualStyle } from "./timelineIcons";

function ClipLintDot({ element }: { element: TimelineElement }) {
  const lint = usePlayerStore((s) => s.lintFindingsByElement.get(element.key ?? element.id));
  if (!lint || lint.count === 0) return null;
  return (
    <span
      className="absolute w-1.5 h-1.5 rounded-full bg-amber-400"
      style={{ top: 7, right: 7 }}
      title={lint.messages.join("\n")}
    />
  );
}

export function renderClipChildren(
  element: TimelineElement,
  clipStyle: TrackVisualStyle,
  renderClipContent:
    | ((element: TimelineElement, style: { clip: string; label: string }) => ReactNode)
    | undefined,
  renderClipOverlay: ((element: TimelineElement) => ReactNode) | undefined,
): ReactNode {
  return (
    <>
      {renderClipOverlay?.(element)}
      {!renderClipContent && <ClipLintDot element={element} />}
      {renderClipContent && (
        // borderRadius: inherit — the clip itself is overflow-visible (keyframe
        // diamonds hang outside its bounds), so the thumbnail layer must clip
        // itself to the clip's rounded corners or sharp corners poke out.
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "inherit" }}>
          {renderClipContent(element, clipStyle)}
        </div>
      )}
    </>
  );
}
