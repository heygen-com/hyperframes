// @vitest-environment happy-dom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomEditGestureReadout } from "./DomEditGestureReadout";
import {
  createGestureReadout,
  updateGestureReadout,
  updateGestureReadoutAngle,
} from "./domEditGestureReadoutState";

const frames = vi.hoisted(() => ({ update: () => {} }));
vi.mock("./overlayFrameLoop", () => ({
  subscribeOverlayFrame: (update: () => void) => {
    frames.update = update;
    return () => {
      frames.update = () => {};
    };
  },
}));
// React needs its runtime test flag, which the global typings do not declare.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function mount(
  kind: "drag" | "resize" | "rotate",
  {
    overlayWidth = 500,
    height = 60,
    stageHeight = 400,
    angle = undefined as number | undefined,
    localAngle = undefined as number | undefined,
  } = {},
) {
  const host = document.createElement("div");
  const overlay = document.createElement("div");
  const iframe = document.createElement("iframe");
  document.body.append(host, overlay, iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Missing preview document");
  const composition = doc.createElement("div");
  composition.setAttribute("data-composition-id", "scene");
  composition.setAttribute("data-width", "1000");
  composition.setAttribute("data-height", "800");
  const element = doc.createElement("div");
  composition.append(element);
  doc.body.append(composition);
  let x = 70.25;
  let y = 40.75;
  const width = 100;
  overlay.getBoundingClientRect = () => new DOMRect(20, 30, overlayWidth, 400);
  iframe.getBoundingClientRect = () => new DOMRect(20, 30, overlayWidth, stageHeight);
  composition.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800);
  element.getBoundingClientRect = () => new DOMRect(x, y, width, height);
  Object.defineProperties(element, {
    offsetWidth: { value: width },
    offsetHeight: { value: height },
  });
  const gestureRef: ComponentProps<typeof DomEditGestureReadout>["gestureRef"] = {
    current: {
      travelled: true,
      readout: createGestureReadout(overlay, iframe, {
        left: x / 2,
        top: y / 2,
        width: width / 2,
        height: height / 2,
        editScaleX: 0.5,
        editScaleY: 0.5,
        angle,
      }),
    },
  };
  const update = (text?: string) =>
    updateGestureReadout(
      gestureRef.current?.readout,
      {
        left: x / 2,
        top: y / 2,
        width: width / 2,
        height: height / 2,
        editScaleX: 0.5,
        editScaleY: 0.5,
        angle: localAngle ?? angle,
      },
      text,
    );
  update(kind === "resize" ? "W 100 · H 60" : kind === "rotate" ? "↻ 0°" : undefined);
  root = createRoot(host);
  act(() =>
    root?.render(
      <DomEditGestureReadout
        gestureRef={gestureRef}
        overlayRef={{ current: overlay }}
        iframeRef={{ current: iframe }}
      />,
    ),
  );
  const label = host.querySelector<HTMLDivElement>("[data-dom-edit-gesture-readout]");
  if (!label) throw new Error("Missing readout");
  Object.defineProperties(label, { offsetWidth: { value: 120 }, offsetHeight: { value: 24 } });
  const draw = () => frames.update();
  const end = () => {
    gestureRef.current = null;
    draw();
  };
  return {
    measurements: [overlay, iframe, composition, element].map((node) =>
      vi.spyOn(node, "getBoundingClientRect"),
    ),
    element,
    gestureRef,
    update,
    doc,
    label,
    draw,
    end,
    move: (nextX: number, nextY: number) => {
      x = nextX;
      y = nextY;
      update();
    },
  };
}

/** The chip's fields as [name, figure] pairs. */
const fields = (label: Element) =>
  [...label.querySelectorAll(":scope > span.flex")].map((field) => [
    field.children[0]?.textContent,
    field.children[1]?.textContent,
  ]);

describe("gesture readout", () => {
  it("adds no layout reads while drawing and stays hidden on a plain press", () => {
    const view = mount("drag");
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
    if (!view.gestureRef.current) throw new Error("Missing gesture");
    view.gestureRef.current.travelled = false;
    view.draw();
    expect(view.label.style.display).toBe("none");
    view.gestureRef.current.travelled = true;
    view.move(120, 70);
    view.draw();
    view.draw();
    expect(fields(view.label)).toEqual([
      ["X", "120"],
      ["Y", "70"],
    ]);
    expect(measure).not.toHaveBeenCalled();
    for (const measurement of view.measurements) expect(measurement).not.toHaveBeenCalled();
    measure.mockRestore();
    for (const measurement of view.measurements) measurement.mockRestore();
  });
  it("shows rounded composition coordinates during a move, accounting for preview zoom", () => {
    const view = mount("drag");
    view.draw();
    expect(fields(view.label)).toEqual([
      ["X", "70"],
      ["Y", "41"],
    ]);
    view.move(120.25, 70.75);
    view.draw();
    expect(fields(view.label)).toEqual([
      ["X", "120"],
      ["Y", "71"],
    ]);
    expect(view.doc.querySelector("[data-dom-edit-gesture-readout]")).toBeNull();
    view.end();
    expect(view.label.style.display).toBe("none");
  });
  it("shows the actual size draft during resize and hides on release", () => {
    const view = mount("resize");
    view.draw();
    expect(fields(view.label)).toEqual([
      ["W", "100"],
      ["H", "60"],
    ]);
    view.update("W 144 · H 87");
    view.draw();
    expect(fields(view.label)).toEqual([
      ["W", "144"],
      ["H", "87"],
    ]);
    view.end();
    expect(view.label.style.display).toBe("none");
  });
  it("reads the live angle during rotation and hides on cancellation", () => {
    const view = mount("rotate");
    view.update("↻ 32°");
    view.draw();
    expect(fields(view.label)).toEqual([["↻", "32°"]]);
    view.update("↻ -46°");
    view.draw();
    expect(fields(view.label)).toEqual([["↻", "-46°"]]);
    view.end();
    expect(view.label.style.display).toBe("none");
  });
  it("sits below the element, centred, clear of the text toolbar above it", () => {
    const view = mount("drag");
    view.move(300, 200);
    view.draw();
    expect(view.label.style.left).toBe("175px");
    expect(view.label.style.top).toBe("138px");
    expect(view.label.style.transform).toBe("translateX(-50%)");
  });
  it("goes beside the element when there is no room below it", () => {
    const view = mount("drag");
    view.move(300, 700);
    view.draw();
    expect(view.label.style.left).toBe("208px");
    expect(view.label.style.top).toBe("349px");
    expect(view.label.style.transform).toBe("none");
    view.move(880, 700);
    view.draw();
    expect(view.label.style.left).toBe("432px");
    expect(view.label.style.transform).toBe("translateX(-100%)");
  });
  it("goes above the toolbar's band when neither below nor either side has room", () => {
    const view = mount("drag", { overlayWidth: 150 });
    view.move(100, 700);
    view.draw();
    expect(view.label.style.top).toBe("266px");
    expect(view.label.style.transform).toBe("translateX(-50%)");
  });
  it("is not placed below an element whose toolbar has dropped below it", () => {
    const view = mount("drag");
    view.move(300, 10);
    view.draw();
    expect(view.label.style.transform).toBe("translateX(-100%)");
    expect(view.label.style.left).toBe("142px");
  });
  it("keeps its side for the whole gesture while that side still fits", () => {
    const view = mount("drag");
    view.move(300, 700);
    view.draw();
    expect(view.label.style.transform).toBe("none");
    view.move(300, 200);
    view.draw();
    expect(view.label.style.left).toBe("208px");
    expect(view.label.style.top).toBe("99px");
    view.move(900, 200);
    view.draw();
    expect(view.label.style.transform).toBe("translateX(-50%)");
  });
  it("clamps the label inside the visible overlay at either edge", () => {
    const view = mount("drag");
    view.move(900, -100);
    view.draw();
    expect(view.label.style.top).toBe("40px");
    view.move(-900, 900);
    view.draw();
    expect(view.label.style.left).toBe("78px");
    expect(view.label.style.top).toBe("364px");
  });
  it("while rotating, places from the rotated box and keeps the angle apart from the size", () => {
    const view = mount("rotate");
    const readout = view.gestureRef.current?.readout;
    updateGestureReadoutAngle(readout, 90);
    expect(readout?.rect.width).toBe(50);
    expect(readout?.rect.angle).toBe(90);
    updateGestureReadoutAngle(readout, 0);
    expect(readout?.rect.angle).toBe(0);
    expect(readout?.text).toBe("↻ 0°");
  });
  it("clears an element that was already rotated when it is dragged", () => {
    const view = mount("drag", { angle: 90 });
    view.move(300, 200);
    view.draw();
    expect(view.label.style.top).toBe("148px");
  });
  it("uses the painted angle, not the element's own, under a rotated parent", () => {
    const counter = mount("drag", { angle: 0, localAngle: -90 });
    counter.move(300, 200);
    counter.draw();
    expect(counter.label.style.top).toBe("138px");
    const parentOnly = mount("drag", { angle: 90, localAngle: 0 });
    parentOnly.move(300, 200);
    parentOnly.draw();
    expect(parentOnly.label.style.top).toBe("148px");
  });
  it("turns the painted angle by the change in the element's own angle while rotating", () => {
    const view = mount("rotate", { angle: 90, localAngle: 0 });
    const readout = view.gestureRef.current?.readout;
    updateGestureReadoutAngle(readout, 30, 0);
    expect(readout?.rect.angle).toBe(120);
    expect(readout?.text).toBe("↻ 30°");
  });
  it("clears an element that was already rotated when it is resized", () => {
    const view = mount("resize", { angle: 90 });
    view.move(300, 200);
    view.draw();
    expect(view.label.style.top).toBe("148px");
  });
  it("never puts a side chip off the stage, left or right, even when that side was kept", () => {
    const first = mount("drag");
    first.move(-900, 700);
    first.draw();
    expect(first.label.style.transform).toBe("translateX(-50%)");
    const second = mount("drag");
    second.move(1800, 700);
    second.draw();
    expect(second.label.style.transform).toBe("translateX(-50%)");
    const keptRight = mount("drag");
    keptRight.move(300, 700);
    keptRight.draw();
    expect(keptRight.label.style.transform).toBe("none");
    keptRight.move(-900, 700);
    keptRight.draw();
    expect(keptRight.label.style.transform).toBe("translateX(-50%)");
    const keptLeft = mount("drag");
    keptLeft.move(880, 700);
    keptLeft.draw();
    expect(keptLeft.label.style.transform).toBe("translateX(-100%)");
    keptLeft.move(1800, 700);
    keptLeft.draw();
    expect(keptLeft.label.style.transform).toBe("translateX(-50%)");
  });
  const inside = (label: HTMLElement, top: number, bottom: number) => {
    const y = Number.parseFloat(label.style.top);
    expect(y).toBeGreaterThanOrEqual(top);
    expect(y + 32).toBeLessThanOrEqual(bottom);
  };
  it("stays inside the stage when the element touches the bottom edge", () => {
    const view = mount("drag");
    view.move(300, 740);
    view.draw();
    inside(view.label, 4, 396);
  });
  it("stays inside the stage when the element touches the top edge", () => {
    const view = mount("drag");
    view.move(300, 0);
    view.draw();
    inside(view.label, 4, 396);
  });
  it("stays inside the stage for an element as tall as the stage", () => {
    const view = mount("drag", { height: 800 });
    view.move(300, 0);
    view.draw();
    inside(view.label, 4, 396);
    const narrow = mount("drag", { height: 800, overlayWidth: 150 });
    narrow.move(100, 0);
    narrow.draw();
    inside(narrow.label, 4, 396);
  });
  it("lands below the preview toolbar when the element is larger than the stage", () => {
    const view = mount("drag", { height: 800, overlayWidth: 150 });
    view.move(100, 0);
    view.draw();
    expect(Number.parseFloat(view.label.style.top)).toBeGreaterThanOrEqual(40);
  });
  it("bounds the chip by the stage, not the larger canvas area around it", () => {
    const view = mount("drag", { stageHeight: 300 });
    view.move(300, 500);
    view.draw();
    inside(view.label, 4, 296);
  });
});
