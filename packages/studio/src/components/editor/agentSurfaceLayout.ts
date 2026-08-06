import type { CSSProperties } from "react";
import { clampNumber } from "../../utils/studioHelpers";
import type { OverlayRect } from "./domEditOverlayGeometry";

/**
 * Where the agent's two canvas surfaces go.
 *
 * The composer and the answer bubble both belong to the same element, so laid
 * out independently they land on top of each other. The composer's own rule
 * decides where it goes — beside the element, at its top right — and this
 * places the bubble around it: below the element by default, above when there
 * is no room, and pushed clear when either would cross the composer.
 */

export const AGENT_SURFACE_GAP = 10;
/** Keeps a tail inside the bubble's rounded corner. */
const TAIL_INSET = 14;

export interface SurfaceSize {
  width: number;
  height: number;
}

export interface SurfacePlacement {
  left: number;
  top: number;
  side: "above" | "below";
}

export interface BubblePlacement extends SurfacePlacement {
  /** Tail offset inside the bubble, so it keeps pointing at the element. */
  tailLeft: number;
}

export interface AgentSurfaceLayout {
  composer?: SurfacePlacement;
  bubble?: BubblePlacement;
}

function centeredLeft(rect: OverlayRect, canvas: SurfaceSize, width: number): number {
  return clampNumber(
    rect.left + rect.width / 2 - width / 2,
    AGENT_SURFACE_GAP,
    Math.max(AGENT_SURFACE_GAP, canvas.width - width - AGENT_SURFACE_GAP),
  );
}

function clampTop(top: number, canvas: SurfaceSize, height: number): number {
  return clampNumber(
    top,
    AGENT_SURFACE_GAP,
    Math.max(AGENT_SURFACE_GAP, canvas.height - height - AGENT_SURFACE_GAP),
  );
}

function fitsBelow(rect: OverlayRect, canvas: SurfaceSize, height: number): boolean {
  return rect.top + rect.height + AGENT_SURFACE_GAP + height <= canvas.height - AGENT_SURFACE_GAP;
}

function place(
  rect: OverlayRect,
  canvas: SurfaceSize,
  size: SurfaceSize,
  side: "above" | "below",
): SurfacePlacement {
  const top =
    side === "below"
      ? rect.top + rect.height + AGENT_SURFACE_GAP
      : rect.top - size.height - AGENT_SURFACE_GAP;
  return {
    left: centeredLeft(rect, canvas, size.width),
    top: clampTop(top, canvas, size.height),
    side,
  };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Two boxes overlap when they overlap on both axes. Touching edges do not. */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

export function layoutAgentSurfaces({
  rect,
  canvas,
  composer,
  bubble,
}: {
  rect: OverlayRect;
  canvas: SurfaceSize;
  /** Where the composer already decided to sit, and how big it is. */
  composer: (SurfaceSize & { left: number; top: number }) | null;
  bubble: SurfaceSize | null;
}): AgentSurfaceLayout {
  const layout: AgentSurfaceLayout = {};
  if (composer) {
    layout.composer = {
      left: composer.left,
      top: composer.top,
      // Beside the element, so "side" only tells the state badge which way to
      // go to stay clear of it.
      side: composer.top < rect.top + rect.height / 2 ? "above" : "below",
    };
  }
  if (!bubble) return layout;

  const composerBox: Box | null = composer
    ? { left: composer.left, top: composer.top, width: composer.width, height: composer.height }
    : null;
  const boxFor = (placement: SurfacePlacement): Box => ({
    left: placement.left,
    top: placement.top,
    width: bubble.width,
    height: bubble.height,
  });

  const preferred = fitsBelow(rect, canvas, bubble.height) ? "below" : "above";
  let placement = place(rect, canvas, bubble, preferred);

  if (composerBox && overlaps(boxFor(placement), composerBox)) {
    const mirrored = place(rect, canvas, bubble, preferred === "below" ? "above" : "below");
    placement = overlaps(boxFor(mirrored), composerBox)
      ? // Both sides are taken: sit beyond the composer rather than across it.
        {
          left: centeredLeft(rect, canvas, bubble.width),
          top: clampTop(
            preferred === "below"
              ? composerBox.top + composerBox.height + AGENT_SURFACE_GAP
              : composerBox.top - bubble.height - AGENT_SURFACE_GAP,
            canvas,
            bubble.height,
          ),
          side: preferred,
        }
      : mirrored;
  }

  layout.bubble = {
    ...placement,
    tailLeft: clampNumber(
      rect.left + rect.width / 2 - placement.left,
      TAIL_INSET,
      bubble.width - TAIL_INSET,
    ),
  };
  return layout;
}

export const COMPOSER_WIDTH = 320;
/** Collapsed width of the ask handle; it expands to its label on hover. */
export const HANDLE_WIDTH = 26;
export const COMPOSER_HEIGHT = 84;

/**
 * Place the composer under the selection, flipping above when it would fall off
 * the bottom, and clamping both axes to the canvas. A null rect (element
 * scrolled out of view, or opened from the inspector) pins it to the bottom.
 */
export function resolveComposerPosition(
  rect: OverlayRect | null,
  canvas: { width: number; height: number },
  composerHeight: number = COMPOSER_HEIGHT,
): CSSProperties {
  if (!rect || canvas.width === 0) {
    return {
      left: Math.max(AGENT_SURFACE_GAP, (canvas.width - COMPOSER_WIDTH) / 2),
      top: Math.max(AGENT_SURFACE_GAP, canvas.height - composerHeight - AGENT_SURFACE_GAP),
    };
  }

  // Anchored to the element's top-right corner: just past its right edge, level
  // with its top. The box is 320 wide and a canvas often is not, so it slides
  // left only as far as the canvas forces — overlapping the element's right
  // side rather than jumping to another edge. A surface that moves around the
  // element is harder to find than one that is always in the same corner.
  return {
    left: clampNumber(
      rect.left + rect.width + AGENT_SURFACE_GAP,
      AGENT_SURFACE_GAP,
      Math.max(AGENT_SURFACE_GAP, canvas.width - COMPOSER_WIDTH - AGENT_SURFACE_GAP),
    ),
    top: clampNumber(rect.top, AGENT_SURFACE_GAP, Math.max(AGENT_SURFACE_GAP, canvas.height - composerHeight - AGENT_SURFACE_GAP)),
  };
}
