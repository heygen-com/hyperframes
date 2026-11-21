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

type Shown = { left: number; top: number; width: number; height: number; angle?: number };

/** Studio's crop handles on the stand-in, over the oriented box the frame's geometry gives the selection. */
function cropHandles(standIn: HTMLElement, onStyleCommit = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const show = (shown: Shown) =>
    act(() =>
      root.render(
        createElement(DomEditCropHandles, {
          selection: {
            element: standIn,
            id: "card",
            selector: "#card",
          } as unknown as DomEditSelection,
          overlayRect: { ...shown, editScaleX: 1, editScaleY: 1 },
          onStyleCommit,
        }),
      ),
    );
  const turn = () =>
    document.querySelector<HTMLElement>("[data-dom-edit-crop-frame]")!.style.transform;
  return { root, show, turn };
}

/** Drags the right crop edge by `dx, dy` screen px and lets go, all before the frame answers. */
async function cropRightOn(standIn: HTMLElement, shown: Shown, dx: number, dy: number) {
  const onStyleCommit = vi.fn();
  const { root, show } = cropHandles(standIn, onStyleCommit);
  show(shown);
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
  const shown = { left: 0, top: 0, width: 400, height: 200 };
  expect(await cropRightOn(standIn, shown, -20, 0)).toEqual([
    "clip-path",
    "inset(0px 10px 0px 0px)",
  ]);
});

it("crops a sealed card turned a quarter along its own width, as an unsealed crop does", async () => {
  const painted = [0, 0, 100, 200];
  const standIn = await sealedCard("matrix(0, 1, -1, 0, 0, 0)", painted);
  const shown = { left: -50, top: 50, width: 200, height: 100, angle: 90 };
  expect(await cropRightOn(standIn, shown, 0, -20)).toEqual([
    "clip-path",
    "inset(0px 20px 0px 0px)",
  ]);
});

// fails without the fix: before a press, a sealed crop frame was drawn on the stand-in, which has no turn.
it("draws a sealed turned card's crop frame turned before any press", async () => {
  const standIn = await sealedCard("rotate(30deg)", [0, 0, 223, 187]);
  const { root, show, turn } = cropHandles(standIn);

  show({ left: 12, top: 44, width: 200, height: 100, angle: 30 });

  expect(turn()).toBe("rotate(30deg)");
  act(() => root.unmount());
});

// fails without the fix: the turn measured at a press was held until the selection changed.
it("redraws a sealed crop frame at the turn the card has after a scrub, once a press measured it", async () => {
  const standIn = await sealedCard("rotate(30deg)", [0, 0, 223, 187]);
  const { root, show, turn } = cropHandles(standIn);
  show({ left: 12, top: 44, width: 200, height: 100, angle: 30 });
  const edge = document.querySelector<HTMLElement>('[aria-label="Crop right"]')!;
  const send = (type: string, buttons: number) =>
    edge.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 7, buttons, clientX: 200, clientY: 100 }),
    );
  act(() => send("pointerdown", 1));
  act(() => send("pointerup", 0));
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

  show({ left: 12, top: 44, width: 200, height: 100, angle: 50 });

  expect(turn()).toBe("rotate(50deg)");
  act(() => root.unmount());
});
