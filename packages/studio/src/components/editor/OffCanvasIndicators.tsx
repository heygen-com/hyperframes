import React from "react";
import { type DomEditSelection } from "./domEditing";

export interface OffCanvasRect {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface OffCanvasIndicatorsProps {
  rects: OffCanvasRect[];
  elements: React.MutableRefObject<Map<string, HTMLElement>>;
  compRect: { left: number; top: number; width: number; height: number };
  selection: DomEditSelection | null;
  groupSelections: DomEditSelection[];
  activeCompositionPathRef: React.MutableRefObject<string | null>;
  onSelectionChangeRef: React.MutableRefObject<
    (selection: DomEditSelection, options?: { revealPanel?: boolean; additive?: boolean }) => void
  >;
}

/**
 * Dashed teal indicators for elements whose bounds extend past the composition
 * (the "gray zone"). The in-canvas portion is clipped away so only the
 * protruding sliver is dashed; the inside portion gets a solid outline.
 * Extracted from DomEditOverlay to keep that file under the 600-LOC cap.
 */
export function OffCanvasIndicators({
  rects,
  elements,
  compRect,
  selection,
  groupSelections,
  activeCompositionPathRef,
  onSelectionChangeRef,
}: OffCanvasIndicatorsProps): React.ReactElement {
  return (
    <>
      {rects
        .filter((r) => {
          // Suppress the indicator for any currently-selected element (primary
          // OR a marquee group member) — those already render a selection box.
          const el = elements.current.get(r.key);
          if (!el) return true;
          if (selection?.element === el) return false;
          return !groupSelections.some((g) => g.element === el);
        })
        .map((r) => {
          const pos = { left: r.left, top: r.top, width: r.width, height: r.height };
          const cL = Math.max(0, compRect.left - r.left);
          const cT = Math.max(0, compRect.top - r.top);
          const cR = Math.min(r.width, compRect.left + compRect.width - r.left);
          const cB = Math.min(r.height, compRect.top + compRect.height - r.top);
          const hasInside = cL < cR && cT < cB;
          const clipOutside = hasInside
            ? `polygon(evenodd, 0 0, ${r.width}px 0, ${r.width}px ${r.height}px, 0 ${r.height}px, 0 0, ${cL}px ${cT}px, ${cR}px ${cT}px, ${cR}px ${cB}px, ${cL}px ${cB}px, ${cL}px ${cT}px)`
            : undefined;
          const clipInside = `inset(${cT}px ${Math.max(0, r.width - cR)}px ${Math.max(0, r.height - cB)}px ${cL}px round 6px)`;
          const selectOffCanvas = async () => {
            const el = elements.current.get(r.key);
            if (!el) return;
            const { resolveDomEditSelection } = await import("./domEditingLayers");
            const acp = activeCompositionPathRef.current ?? "index.html";
            const sel = await resolveDomEditSelection(el, {
              activeCompositionPath: acp,
              isMasterView: !acp || acp === "index.html",
              skipSourceProbe: true,
            });
            if (sel) onSelectionChangeRef.current(sel, { revealPanel: true });
          };
          const handleClick = (e: React.MouseEvent) => {
            e.stopPropagation();
            void selectOffCanvas();
          };
          return (
            <div key={`offcanvas-${r.key}`} className="pointer-events-none absolute" style={pos}>
              {/* Dashed layer — clipped to exclude canvas area.
                  Note: clip-path is visual only — hit-testing still covers the
                  full bounding rect, so clicking the in-canvas portion selects
                  via this handler. That's acceptable: it resolves the same
                  element the normal canvas path would, just with
                  skipSourceProbe (the element is already known here). */}
              <div
                role="button"
                tabIndex={0}
                aria-label={`Select off-canvas element ${r.key}`}
                className="pointer-events-auto absolute inset-0 border-2 border-dashed border-studio-accent/60 rounded-md cursor-pointer hover:border-studio-accent hover:bg-studio-accent/10 transition-colors"
                style={clipOutside ? { clipPath: clipOutside } : undefined}
                title={`Off-canvas: ${r.key} — click to select`}
                onClick={handleClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    void selectOffCanvas();
                  }
                }}
              />
              {/* Solid layer — clipped to canvas bounds, covers inside portion */}
              <div
                className="pointer-events-none absolute inset-0 border border-studio-accent/80 rounded-md bg-studio-accent/5 shadow-[0_0_0_1px_rgba(60,230,172,0.25)]"
                style={{ clipPath: clipInside }}
              />
            </div>
          );
        })}
    </>
  );
}
