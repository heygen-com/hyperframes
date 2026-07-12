// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import type { GestureState, UseDomEditOverlayGesturesOptions } from "./domEditOverlayGestures";

// Origin box (overlay px). The gesture-start center is its centroid; the
// center-anchored resize must keep THIS point planted, which means the release
// must commit a nonzero offset equal to minus half the size growth.
const ORIGIN = { left: 0, top: 0, width: 200, height: 100 };
const ORIGIN_CENTER = {
  x: ORIGIN.left + ORIGIN.width / 2,
  y: ORIGIN.top + ORIGIN.height / 2,
};

// Consistent geometry stub: model the physical truth the real DOM would report.
// A CSS width/height change grows the box from its top-left, so the rendered
// center drifts by half the size delta; the manual offset the gesture applies
// (read back from the element's studio vars) pulls it back. `elementCornerOverlayPoints`
// returns the four corners of that drifted box; `overlayCornersCentroid` (kept
// real) averages them so the anchor loop can measure the true center each frame.
vi.mock("./domEditOverlayGeometry", async () => {
  const actual = await vi.importActual<typeof import("./domEditOverlayGeometry")>(
    "./domEditOverlayGeometry",
  );
  const { readStudioBoxSize, readStudioPathOffset } = await import("./manualEditsDom");
  const physicalCenter = (element: HTMLElement) => {
    const size = readStudioBoxSize(element);
    const width = size.width > 0 ? size.width : ORIGIN.width;
    const height = size.height > 0 ? size.height : ORIGIN.height;
    const offset = readStudioPathOffset(element);
    return {
      x: ORIGIN_CENTER.x + (width - ORIGIN.width) / 2 + offset.x,
      y: ORIGIN_CENTER.y + (height - ORIGIN.height) / 2 + offset.y,
      width,
      height,
    };
  };
  return {
    ...actual,
    elementCornerOverlayPoints: (_o: unknown, _i: unknown, element: HTMLElement) => {
      const c = physicalCenter(element);
      const hw = c.width / 2;
      const hh = c.height / 2;
      return {
        nw: { x: c.x - hw, y: c.y - hh },
        ne: { x: c.x + hw, y: c.y - hh },
        sw: { x: c.x - hw, y: c.y + hh },
        se: { x: c.x + hw, y: c.y + hh },
      };
    },
    orientedOverlayRect: (_o: unknown, _i: unknown, element: HTMLElement) => {
      const c = physicalCenter(element);
      return {
        left: c.x - c.width / 2,
        top: c.y - c.height / 2,
        width: c.width,
        height: c.height,
        editScaleX: 1,
        editScaleY: 1,
        angle: 0,
      };
    },
  };
});

const { createDomEditOverlayGestureHandlers } = await import("./useDomEditOverlayGestures");

function ref<T>(current: T) {
  return { current };
}

interface CommitCall {
  size: { width: number; height: number };
  offset: { x: number; y: number } | undefined;
}

function buildHarness() {
  const element = document.createElement("div");
  document.body.append(element);

  const selection = {
    element,
    id: "box",
    selector: "#box",
    selectorIndex: 0,
    sourceFile: "index.html",
    tagName: "div",
    label: "Box",
    textContent: "",
    textFields: [],
    capabilities: {
      canEditText: false,
      canEditLayout: true,
      canMove: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: false,
      canAdjustOpacity: true,
      canAdjustFill: true,
      canAdjustBorderRadius: true,
      canAdjustStroke: true,
      canAdjustShadow: true,
      canAdjustZIndex: true,
    },
    computedStyle: { display: "block", position: "absolute" },
  } as unknown as DomEditSelection;

  const commits: CommitCall[] = [];
  const overlayEl = document.createElement("div");
  const iframe = document.createElement("iframe");

  const opts: UseDomEditOverlayGesturesOptions = {
    overlayRef: ref<HTMLDivElement | null>(overlayEl),
    iframeRef: ref<HTMLIFrameElement | null>(iframe),
    boxRef: ref<HTMLDivElement | null>(document.createElement("div")),
    selectionRef: ref<DomEditSelection | null>(selection),
    hoverSelectionRef: ref<DomEditSelection | null>(null),
    overlayRectRef: ref<OverlayRectLike | null>({
      left: ORIGIN.left,
      top: ORIGIN.top,
      width: ORIGIN.width,
      height: ORIGIN.height,
      editScaleX: 1,
      editScaleY: 1,
    }) as never,
    groupOverlayItemsRef: ref([]),
    gestureRef: ref<GestureState | null>(null),
    groupGestureRef: ref(null),
    blockedMoveRef: ref(null),
    rafPausedRef: ref(false),
    suppressNextBoxClickRef: ref(false),
    setOverlayRect: () => {},
    setGroupOverlayItems: () => {},
    onBlockedMoveRef: ref(() => {}),
    onManualDragStartRef: ref(() => {}),
    onPathOffsetCommitRef: ref(() => {}),
    onGroupPathOffsetCommitRef: ref(() => {}),
    onBoxSizeCommitRef: ref((_s, size, offset) => {
      commits.push({ size, offset });
    }),
    onRotationCommitRef: ref(() => {}),
    onCanvasPointerMoveRef: ref(() => Promise.resolve(null)),
    onCanvasMouseDown: () => {},
    snapGuidesRef: ref(null),
  };

  const handlers = createDomEditOverlayGestureHandlers(opts);
  return { handlers, commits, selection };
}

type OverlayRectLike = {
  left: number;
  top: number;
  width: number;
  height: number;
  editScaleX: number;
  editScaleY: number;
};

function evt(clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    pointerId: 1,
    button: 0,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    currentTarget: { setPointerCapture() {} },
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("anchored corner resize — the release commit feeds the center-pin offset", () => {
  it("onPointerUp passes a nonzero offset that keeps the center planted", () => {
    const { handlers, commits } = buildHarness();

    // Start an SE corner resize. Pointer starts 100px right of the center.
    handlers.startGesture("resize", evt(ORIGIN_CENTER.x + 100, ORIGIN_CENTER.y), {
      resizeHandle: "se",
    });

    // Drag outward to radial scale 1.5 (dist 150 / 100). Several frames so the
    // per-frame center-pin anchor accumulates and converges into g.lastResizeAnchor.
    for (let i = 0; i < 5; i++) {
      handlers.onPointerMove(evt(ORIGIN_CENTER.x + 150, ORIGIN_CENTER.y));
    }

    handlers.onPointerUp(evt(ORIGIN_CENTER.x + 150, ORIGIN_CENTER.y));

    expect(commits).toHaveLength(1);
    const { size, offset } = commits[0]!;

    // Proportional 1.5x growth of the 200x100 base.
    expect(size.width).toBeCloseTo(300, 0);
    expect(size.height).toBeCloseTo(150, 0);

    // The committed offset must be present and nonzero — the open question.
    expect(offset).toBeDefined();
    if (!offset) return;
    expect(offset.x).not.toBe(0);
    expect(offset.y).not.toBe(0);

    // And it must equal minus half the size growth, i.e. it re-pins the center to
    // exactly the gesture-start center (offset = -(finalSize - origin)/2).
    expect(offset.x).toBeCloseTo(-(size.width - ORIGIN.width) / 2, 0);
    expect(offset.y).toBeCloseTo(-(size.height - ORIGIN.height) / 2, 0);
  });
});
