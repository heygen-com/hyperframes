// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import { MotionPathOverlay } from "./MotionPathOverlay";
import type { DomEditSelection } from "./domEditing";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({ selectedGsapAnimations: [], commitMutation: vi.fn() }),
}));
vi.mock("./motionPathSelection", () => ({
  selectorFor: () => "#box",
  editableAnimationId: () => "a1",
}));
// GSAP renders the layer at the first keyframe: the playhead is on it.
vi.mock("../../hooks/gsapPositionDetection", () => ({
  readGsapPositionFromIframe: () => ({ x: 60, y: 30 }),
}));
vi.mock("./useMotionPathData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useMotionPathData")>()),
  useMotionPathData: () => ({
    rect: { left: 0, top: 0, width: 1920, height: 1080 },
    geometry: {
      kind: "linear",
      points: "60,30 120,30",
      nodes: [
        { x: 60, y: 30, ref: { type: "keyframe", pct: 66.667 } },
        { x: 120, y: 30, ref: { type: "keyframe", pct: 100 } },
      ],
    },
    geometryResolved: true,
    visibleInPreview: true,
    home: { x: 0, y: 0 },
    pScale: 1,
  }),
}));

it("the layer's node and another node's ring inside the layer's box press the layer; a dot keeps its node", () => {
  const box = document.createElement("div");
  box.setAttribute("data-dom-edit-selection-box", "true");
  const host = document.createElement("div");
  document.body.append(box, host);
  const boxPresses: number[] = [];
  let boxStarts = true;
  box.addEventListener("pointerdown", (e) => {
    boxPresses.push((e as PointerEvent).clientX);
    if (boxStarts) e.preventDefault();
  });
  const captured = vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
  const root = createRoot(host);
  const selection = { element: document.createElement("div") } as unknown as DomEditSelection;
  // Scale 1: client px are composition px. `inBox`: the layer's box is under the press.
  const press = (node: number, x: number, inBox: boolean) => {
    const hit = [...host.querySelectorAll("circle.pointer-events-auto")].find(
      (c) => c.getAttribute("cx") === String(node),
    )!;
    document.elementsFromPoint = () => (inBox ? [hit, box] : [hit]);
    const down = { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 30 };
    act(() => void hit.dispatchEvent(new PointerEvent("pointerdown", down)));
  };
  try {
    act(() =>
      root.render(
        <MotionPathOverlay
          iframeRef={{ current: null }}
          selection={selection}
          compositionSize={{ width: 1920, height: 1080 }}
          isPlaying={false}
        />,
      ),
    );
    press(60, 63, false);
    press(120, 110, true);
    expect(boxPresses).toEqual([63, 110]);
    press(120, 118, true);
    press(120, 110, false);
    expect(boxPresses).toEqual([63, 110]);
    // A selected node draws its dot 1.5x as large, and the larger dot is the node's.
    act(() => usePlayerStore.setState({ activeKeyframePct: 100 }));
    press(120, 112, true);
    expect(boxPresses).toEqual([63, 110]);
    act(() => usePlayerStore.setState({ activeKeyframePct: null }));
    press(120, 112, true);
    expect(boxPresses).toEqual([63, 110, 112]);
    // A box that starts no gesture leaves the press to the node.
    boxStarts = false;
    captured.mockClear();
    press(60, 63, false);
    expect(captured).toHaveBeenCalledTimes(1);
  } finally {
    captured.mockRestore();
    act(() => root.unmount());
    box.remove();
    host.remove();
  }
});
