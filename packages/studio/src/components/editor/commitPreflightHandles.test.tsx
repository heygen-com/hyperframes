// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { makeSelection } from "../../hooks/domSelectionTestHarness";
import { GSAP_EDIT_BLOCK_COPY } from "../../hooks/gsapEditOutcome";
import { useCommitPreflightCapabilities } from "../../hooks/useCommitPreflightCapabilities";
import { CANVAS_NUDGE_COMMIT_DEBOUNCE_MS } from "./domEditNudge";
import { __resetForTests } from "../../utils/canvasNudgeGate";
import type { DomEditSelection } from "./domEditing";
import "./domEditOverlayTestMocks";
import { DomEditOverlay } from "./DomEditOverlay";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./useDomEditOverlayRects", () => {
  const rect = { left: 100, top: 100, width: 200, height: 100, editScaleX: 1, editScaleY: 1 };
  return {
    useDomEditOverlayRects: () => ({
      overlayRect: rect,
      overlayRectRef: { current: rect },
      setOverlayRect: () => undefined,
      hoverRect: null,
      groupOverlayItems: [],
      groupOverlayItemsRef: { current: [] },
      setGroupOverlayItems: () => undefined,
      childRects: [],
    }),
  };
});

const BOX = '[data-dom-edit-selection-box="true"]';
const DOTS = "div.h-4.w-4";
const ROTATE = '[aria-label="Rotate selection"]';
let root: Root;
let host: HTMLElement;

function tween(
  properties: Record<string, number>,
  extra: Partial<GsapAnimation> = {},
): GsapAnimation {
  return {
    id: `#title-to-${Object.keys(properties).join("-")}`,
    targetSelector: "#title",
    method: "to",
    properties,
    position: 0,
    resolvedStart: 0,
    duration: 2,
    ...extra,
  } as unknown as GsapAnimation;
}

/** Studio's session narrowing feeding the real overlay, as the editor mounts it. */
function mount(animations: Promise<GsapAnimation[]>) {
  const spies = {
    onBlockedMove: vi.fn(),
    onPathOffsetCommit: vi.fn(),
    onManualDragStart: vi.fn(),
  };
  const element = document.createElement("h1");
  element.id = "title";
  document.body.append(element);
  const resolved = makeSelection("title", element);
  resolved.capabilities.canApplyManualRotation = true;
  const seen: { selection: DomEditSelection | null } = { selection: null };
  const iframeRef = { current: document.createElement("iframe") };
  const makeFetchFallback = () => () => animations;
  function Editor() {
    const { selection } = useCommitPreflightCapabilities({
      enabled: true,
      selection: resolved,
      groupSelections: [resolved],
      previewIframeRef: { current: null },
      makeFetchFallback,
      version: 0,
    });
    seen.selection = selection;
    return (
      <DomEditOverlay
        iframeRef={iframeRef}
        activeCompositionPath={null}
        selection={selection}
        hoverSelection={null}
        onCanvasMouseDown={() => undefined}
        onCanvasPointerMove={() => Promise.resolve(selection)}
        onCanvasPointerLeave={() => undefined}
        onSelectionChange={() => undefined}
        onGroupPathOffsetCommit={() => undefined}
        onBoxSizeCommit={() => undefined}
        onRotationCommit={() => undefined}
        {...spies}
      />
    );
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Editor />));
  return { spies, seen, overlay: host.firstElementChild as HTMLElement };
}

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 10; tick++) await Promise.resolve();
  });
}

const fire = (target: Element, type: string, init: MouseEventInit = {}) => {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
  });
};

describe("handles follow what Studio would commit", () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = () => undefined;
    __resetForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  it("hides every handle on a helper-loop animation and says why", async () => {
    const loop = tween({ x: 120, rotation: 30, width: 320 }, {
      provenance: { kind: "loop" },
    } as never);
    const { seen, overlay, spies } = mount(Promise.resolve([loop]));
    await settle();

    expect(seen.selection?.capabilities).toMatchObject({
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
      reasonIfDisabled: GSAP_EDIT_BLOCK_COPY["unroll-required"],
    });
    expect(overlay.querySelectorAll(DOTS)).toHaveLength(0);
    expect(overlay.querySelector(ROTATE)).toBeNull();
    expect((overlay.querySelector(BOX) as HTMLElement).style.cursor).toBe("default");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      vi.advanceTimersByTime(CANVAS_NUDGE_COMMIT_DEBOUNCE_MS + 10);
    });
    expect(spies.onPathOffsetCommit).not.toHaveBeenCalled();
  });

  it("hides every handle on a runtime-computed animation and says why", async () => {
    const computed = tween({ x: 120, rotation: 30, width: 320 }, {
      provenance: { kind: "runtime-dynamic" },
    } as never);
    const { seen, overlay } = mount(Promise.resolve([computed]));
    await settle();

    expect(seen.selection?.capabilities).toMatchObject({
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
      reasonIfDisabled: GSAP_EDIT_BLOCK_COPY["source-uneditable"],
    });
    expect(overlay.querySelectorAll(DOTS)).toHaveLength(0);
    expect(overlay.querySelector(ROTATE)).toBeNull();
  });

  it("keeps every handle on a plain keyframed element, and a drag still commits", async () => {
    const keyframed = tween({}, {
      propertyGroup: "position",
      keyframes: {
        keyframes: [
          { percentage: 0, properties: { x: 0, y: 0 } },
          { percentage: 100, properties: { x: 200, y: 40 } },
        ],
      },
    } as never);
    const { seen, overlay, spies } = mount(Promise.resolve([keyframed]));
    await settle();

    expect(seen.selection?.capabilities).toMatchObject({
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    });
    expect(overlay.querySelectorAll(DOTS)).toHaveLength(4);
    expect(overlay.querySelector(ROTATE)).not.toBeNull();
    const box = overlay.querySelector(BOX)!;
    fire(box, "pointerdown", { clientX: 150, clientY: 150 });
    fire(overlay, "pointermove", { clientX: 190, clientY: 150 });
    fire(overlay, "pointerup", { clientX: 190, clientY: 150 });
    await settle();
    expect(spies.onBlockedMove).not.toHaveBeenCalled();
    expect(spies.onPathOffsetCommit).toHaveBeenCalledTimes(1);
  });

  it("shows no handles while the check is still running", async () => {
    const { seen, overlay } = mount(new Promise<GsapAnimation[]>(() => undefined));
    await settle();

    expect(seen.selection?.capabilities).toMatchObject({
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
    });
    expect(overlay.querySelectorAll(DOTS)).toHaveLength(0);
    expect(overlay.querySelector(ROTATE)).toBeNull();
  });

  it("toasts once on the press of a blocked element, before any travel", async () => {
    const loop = tween({ x: 120 }, { provenance: { kind: "loop" } } as never);
    const { overlay, spies } = mount(Promise.resolve([loop]));
    await settle();
    const box = overlay.querySelector(BOX)!;

    fire(box, "pointerdown", { clientX: 150, clientY: 150 });
    expect(spies.onBlockedMove).toHaveBeenCalledTimes(1);
    expect(spies.onBlockedMove.mock.calls[0]![0].capabilities.reasonIfDisabled).toBe(
      GSAP_EDIT_BLOCK_COPY["unroll-required"],
    );
    fire(overlay, "pointermove", { clientX: 200, clientY: 150 });
    fire(overlay, "pointerup", { clientX: 200, clientY: 150 });
    expect(spies.onBlockedMove).toHaveBeenCalledTimes(1);
    expect(spies.onManualDragStart).not.toHaveBeenCalled();
    expect(spies.onPathOffsetCommit).not.toHaveBeenCalled();
  });

  it("narrows only rotation when only the rotation is a helper's", async () => {
    const spin = tween({ rotation: 90 }, { provenance: { kind: "loop" } } as never);
    const { seen, overlay } = mount(Promise.resolve([spin]));
    await settle();

    expect(seen.selection?.capabilities).toMatchObject({
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: false,
    });
    expect(overlay.querySelectorAll(DOTS)).toHaveLength(4);
    expect(overlay.querySelector(ROTATE)).toBeNull();
  });

  it("narrows only resize when only the size is a helper's", async () => {
    const grow = tween({ width: 320, height: 90 }, { provenance: { kind: "loop" } } as never);
    const { seen, overlay } = mount(Promise.resolve([grow]));
    await settle();

    expect(seen.selection?.capabilities).toMatchObject({
      canApplyManualOffset: true,
      canApplyManualSize: false,
      canApplyManualRotation: true,
    });
    expect(overlay.querySelectorAll(DOTS)).toHaveLength(0);
    expect(overlay.querySelector(ROTATE)).not.toBeNull();
  });
});
