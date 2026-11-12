// @vitest-environment happy-dom
import React, { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomEditGestureReadout } from "./DomEditGestureReadout";
import { createGestureReadout, updateGestureReadout } from "./domEditGestureReadoutState";

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

function mount(kind: "drag" | "resize" | "rotate", { overlayWidth = 500 } = {}) {
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
  const height = 60;
  overlay.getBoundingClientRect = () => new DOMRect(20, 30, overlayWidth, 400);
  iframe.getBoundingClientRect = () => new DOMRect(20, 30, overlayWidth, 400);
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
    expect(view.label.style.transform).toBe("none");
    expect(view.label.style.left).toBe("208px");
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
    expect(view.label.style.top).toBe("4px");
    view.move(-900, 900);
    view.draw();
    expect(view.label.style.left).toBe("78px");
    expect(view.label.style.top).toBe("364px");
  });
});
