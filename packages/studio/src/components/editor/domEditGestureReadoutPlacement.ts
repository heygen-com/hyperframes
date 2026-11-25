import type { GestureReadoutSide, GestureReadoutState } from "./domEditGestureReadoutState";
import type { OverlayRect } from "./domEditOverlayGeometry";
import { GAP_PX as TOOLBAR_GAP_PX, TOOLBAR_HEIGHT_PX } from "./InlineTextToolbar";

const GAP_PX = 8;
const EDGE_PX = 4;
const SNAP_TOOLBAR_BAND_PX = 36;
const SNAP_TOOLBAR_WIDTH_PX = 180;
const CHIP_HEIGHT_PX = 32;
const CHAR_PX = 8;
const CHIP_PADDING_PX = 36;

const SIDES: readonly GestureReadoutSide[] = ["below", "right", "left", "above"];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  toolbarBottom: number;
  toolbarLeft: number;
}

interface Spot {
  x: number;
  y: number;
  fits: boolean;
}

export interface ChipPlacement {
  side: GestureReadoutSide;
  left: number;
  top: number;
  transform: string;
}

function visibleBox(readout: GestureReadoutState): Box {
  const bounds = readout.basis.overlayRect;
  const stage = readout.basis.iframeRect;
  const stageLeft = stage.left - bounds.left;
  const stageTop = stage.top - bounds.top;
  const minY = Math.max(0, -bounds.top, stageTop) + EDGE_PX;
  const maxX =
    Math.min(bounds.width, readout.viewportWidth - bounds.left, stageLeft + stage.width) - EDGE_PX;
  return {
    minX: Math.max(0, -bounds.left, stageLeft) + EDGE_PX,
    minY,
    toolbarBottom: minY + SNAP_TOOLBAR_BAND_PX,
    toolbarLeft: maxX - SNAP_TOOLBAR_WIDTH_PX,
    maxX,
    maxY:
      Math.min(bounds.height, readout.viewportHeight - bounds.top, stageTop + stage.height) -
      EDGE_PX,
  };
}

function clearOfToolbar(box: Box, right: number, top: number): boolean {
  return right <= box.toolbarLeft || top >= box.toolbarBottom;
}

function paintedBox(rect: OverlayRect): OverlayRect {
  const radians = ((rect.angle ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = rect.width * cos + rect.height * sin;
  const height = rect.width * sin + rect.height * cos;
  return {
    ...rect,
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}

function fitsBeside(box: Box, x0: number, x1: number, top: number): boolean {
  const inside =
    x0 >= box.minX && x1 <= box.maxX && top >= box.minY && top + CHIP_HEIGHT_PX <= box.maxY;
  return inside && clearOfToolbar(box, x1, top);
}

function chipSpots(
  readout: GestureReadoutState,
  box: Box,
  width: number,
): Record<GestureReadoutSide, Spot> {
  const rect = paintedBox(readout.rect);
  const right = rect.left + rect.width;
  const bottom = rect.top + rect.height;
  const centre = rect.left + rect.width / 2;
  const middle = rect.top + rect.height / 2 - CHIP_HEIGHT_PX / 2;
  const toolbarBelow =
    readout.basis.overlayRect.top + rect.top - TOOLBAR_GAP_PX < TOOLBAR_HEIGHT_PX;
  const toolbarBand = toolbarBelow ? 0 : TOOLBAR_GAP_PX + TOOLBAR_HEIGHT_PX;
  return {
    below: {
      x: centre,
      y: bottom + GAP_PX,
      fits: !toolbarBelow && bottom + GAP_PX + CHIP_HEIGHT_PX <= box.maxY,
    },
    right: {
      x: right + GAP_PX,
      y: middle,
      fits: fitsBeside(box, right + GAP_PX, right + GAP_PX + width, middle),
    },
    left: {
      x: rect.left - GAP_PX,
      y: middle,
      fits: fitsBeside(box, rect.left - GAP_PX - width, rect.left - GAP_PX, middle),
    },
    above: { x: centre, y: rect.top - GAP_PX - toolbarBand - CHIP_HEIGHT_PX, fits: true },
  };
}

function chooseSide(
  kept: GestureReadoutSide | undefined,
  spots: Record<GestureReadoutSide, Spot>,
): GestureReadoutSide {
  if (kept && spots[kept].fits) return kept;
  return SIDES.find((side) => spots[side].fits) ?? "above";
}

const TRANSFORMS: Record<GestureReadoutSide, string> = {
  below: "translateX(-50%)",
  above: "translateX(-50%)",
  left: "translateX(-100%)",
  right: "none",
};

export function placeChip(readout: GestureReadoutState, text: string): ChipPlacement {
  const box = visibleBox(readout);
  const width = text.length * CHAR_PX + CHIP_PADDING_PX;
  const spots = chipSpots(readout, box, width);
  const side = chooseSide(readout.side, spots);
  const spot = spots[side];
  const centred = TRANSFORMS[side] === "translateX(-50%)";
  const left = centred
    ? Math.max(box.minX + width / 2, Math.min(box.maxX - width / 2, spot.x))
    : spot.x;
  const chipRight = side === "right" ? left + width : side === "left" ? left : left + width / 2;
  const floor = clearOfToolbar(box, chipRight, box.minY) ? box.minY : box.toolbarBottom;
  const top = Math.min(box.maxY - CHIP_HEIGHT_PX, Math.max(floor, spot.y));
  return { side, left, top, transform: TRANSFORMS[side] };
}
