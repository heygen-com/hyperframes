// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { describePreviewElements, queryPreviewElements } from "../../player/lib/previewElements";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import type { DomEditSelection } from "./domEditing";
import { DomEditCropHandles } from "./DomEditCropHandles";
import { standInFor } from "./previewSelection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function sized(element: Element, [x, y, width, height]: number[]) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  return element;
}

/** A 200 x 100 card painted under `transform` on a frame Studio cannot script, and its stand-in. */
async function sealedCard(transform: string, painted: number[]) {
  document.body.innerHTML = `<div data-composition-id="main"><div id="card" style="transform: ${transform}"></div></div>`;
  const card = sized(document.getElementById("card")!, [0, 0, 200, 100]);
  card.getBoundingClientRect = () => {
    const [x, y, width, height] = painted;
    return {
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
    } as DOMRect;
  };
  const { iframe: sealed, frame } = sealedPreviewFrame();
  const iframe = sized(sealed, [0, 0, 1920, 1080]) as HTMLIFrameElement;
  watchPreviewFrame(iframe);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data: { source: "hf-preview", type: "stage-size", width: 1920, height: 1080 },
    }),
  );
  const handle = (await queryPreviewElements(iframe, "#card"))!.matches[0]!.handle;
  return standInFor(iframe, (await describePreviewElements(iframe, [handle]))![0]!);
}

/** Drags the right crop edge by `dx, dy` screen px and lets go, all before the frame answers. */
async function cropRightOn(standIn: HTMLElement, painted: number[], dx: number, dy: number) {
  const onStyleCommit = vi.fn();
  const [left, top, width, height] = painted;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      createElement(DomEditCropHandles, {
        selection: {
          element: standIn,
          id: "card",
          selector: "#card",
        } as unknown as DomEditSelection,
        overlayRect: { left, top, width, height, editScaleX: 1, editScaleY: 1 },
        onStyleCommit,
      }),
    ),
  );
  const edge = document.querySelector<HTMLElement>('[aria-label="Crop right"]')!;
  const send = (type: string, x: number, y: number, buttons: number) =>
    edge.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 7, buttons, clientX: x, clientY: y }),
    );
  act(() => {
    send("pointerdown", 500, 500, 1);
    send("pointermove", 500 + dx, 500 + dy, 1);
    send("pointerup", 500 + dx, 500 + dy, 0);
  });
  await vi.waitFor(() => expect(onStyleCommit).toHaveBeenCalled());
  act(() => root.unmount());
  return onStyleCommit.mock.calls[0];
}

// fails without the fix: a sealed crop measured the stand-in, which has no scale or turn of its own.
it("crops a sealed card GSAP draws at twice its size by its own px, as an unsealed crop does", async () => {
  const painted = [0, 0, 400, 200];
  const standIn = await sealedCard("matrix(2, 0, 0, 2, 0, 0)", painted);
  expect(await cropRightOn(standIn, painted, -20, 0)).toEqual([
    "clip-path",
    "inset(0px 10px 0px 0px)",
  ]);
});

it("crops a sealed card turned a quarter along its own width, as an unsealed crop does", async () => {
  const painted = [0, 0, 100, 200];
  const standIn = await sealedCard("matrix(0, 1, -1, 0, 0, 0)", painted);
  expect(await cropRightOn(standIn, painted, 0, -20)).toEqual([
    "clip-path",
    "inset(0px 20px 0px 0px)",
  ]);
});
