// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePlayerStore } from "../../player/store/playerStore";
import { MotionPathOverlay } from "./MotionPathOverlay";
import type { DomEditSelection } from "./domEditing";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const { commitMutation } = vi.hoisted(() => ({ commitMutation: vi.fn(async () => {}) }));
vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({ selectedGsapAnimations: [], commitMutation }),
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

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  commitMutation.mockClear();
});

/** The overlay over a selected layer's box, scale 1: client px are composition px. */
function mount() {
  const box = document.createElement("div");
  box.setAttribute("data-dom-edit-selection-box", "true");
  box.style.cursor = "move";
  const host = document.createElement("div");
  document.body.append(box, host);
  const boxPresses: number[] = [];
  const state = { boxStarts: true };
  box.addEventListener("pointerdown", (e) => {
    boxPresses.push((e as PointerEvent).clientX);
    if (state.boxStarts) e.preventDefault();
  });
  const captured = vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
  const root = createRoot(host);
  const selection = { element: document.createElement("div") } as unknown as DomEditSelection;
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
  cleanups.push(() => {
    captured.mockRestore();
    act(() => root.unmount());
    box.remove();
    host.remove();
  });
  /** Fires `type` at `target`; `inBox`: the layer's box is under the pointer too. */
  const fire = (target: Element, type: string, x: number, inBox: boolean) => {
    document.elementsFromPoint = () => (inBox ? [target, box] : [target]);
    const init = { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: 30 };
    act(() => void target.dispatchEvent(new PointerEvent(type, init)));
  };
  return { host, boxPresses, state, captured, fire };
}

it("the layer's node and another node's ring inside the layer's box press the layer; a dot keeps its node", () => {
  const { host, boxPresses, state, captured, fire } = mount();
  const press = (node: number, x: number, inBox: boolean) => {
    const hit = [...host.querySelectorAll("circle.pointer-events-auto")].find(
      (c) => c.getAttribute("cx") === String(node),
    )!;
    fire(hit, "pointerdown", x, inBox);
  };
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
  state.boxStarts = false;
  captured.mockClear();
  press(60, 63, false);
  expect(captured).toHaveBeenCalledTimes(1);
});

it("the path's line inside the layer's box moves the layer and offers no add; outside it adds a keyframe", async () => {
  const { host, boxPresses, fire } = mount();
  const line = host.querySelector("polyline.pointer-events-auto") as SVGElement;
  const ghost = () => host.querySelector("rect.pointer-events-none");

  fire(line, "pointermove", 90, true);
  expect(line.style.cursor).toBe("move");
  expect(ghost()).toBeNull();
  fire(line, "pointerdown", 90, true);
  expect(boxPresses).toEqual([90]);
  expect(commitMutation).not.toHaveBeenCalled();

  fire(line, "pointermove", 90, false);
  expect(line.style.cursor).toBe("copy");
  expect(ghost()).not.toBeNull();
  fire(line, "pointerdown", 90, false);
  expect(boxPresses).toEqual([90]);
  await vi.waitFor(() => expect(commitMutation).toHaveBeenCalledTimes(1));
});
