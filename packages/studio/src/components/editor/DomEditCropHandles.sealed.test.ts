// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { watchPreviewFrame } from "../../player/lib/bridgePlayback";
import { usePlayerStore } from "../../player/store/playerStore";
import {
  describePreviewElements,
  previewGeometry,
  queryPreviewElements,
} from "../../player/lib/previewElements";
import { answerTap, sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import type { DomEditSelection } from "./domEditing";
import { DomEditCropHandles } from "./DomEditCropHandles";
import { rememberFrameClipPath } from "./domEditOverlayCrop";
import { previewStandIn } from "./previewDrafts";
import { standInFor } from "./previewSelection";
import { beginStudioManualEditGesture, endStudioManualEditGesture } from "./manualEditGesture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePlayerStore.getState().setCurrentTime(0);
  document.body.innerHTML = "";
});

function sized(element: Element, [x, y, width, height]: number[]) {
  element.getBoundingClientRect = () =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }) as DOMRect;
  Object.defineProperty(element, "offsetWidth", { value: width, configurable: true });
  Object.defineProperty(element, "offsetHeight", { value: height, configurable: true });
  return element;
}

/** `element` laid out at `width` x `height` and painted on screen at `painted`. */
function paint(element: Element, [width, height]: number[], painted: number[]) {
  sized(element, [0, 0, width, height]);
  const [x, y, w, h] = painted;
  element.getBoundingClientRect = () =>
    ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h }) as DOMRect;
}

type Card = { id: string; transform: string; painted: number[]; clip?: string };

/** 200 x 100 cards painted under their `transform` on a frame Studio cannot script, and their stand-ins. */
async function sealedCards(cards: Card[], options?: Parameters<typeof sealedPreviewFrame>[0]) {
  const markup = cards.map(
    ({ id, transform, clip }) =>
      `<div id="${id}" style="transform: ${transform};${clip ? ` clip-path: ${clip}` : ""}"></div>`,
  );
  document.body.innerHTML = `<div data-composition-id="main">${markup.join("")}</div>`;
  for (const { id, painted } of cards) paint(document.getElementById(id)!, [200, 100], painted);
  const { iframe: sealed, frame } = sealedPreviewFrame(options);
  const iframe = sized(sealed, [0, 0, 1920, 1080]) as HTMLIFrameElement;
  watchPreviewFrame(iframe);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame as unknown as Window,
      origin: window.location.origin,
      data: { source: "hf-preview", type: "stage-size", width: 1920, height: 1080 },
    }),
  );
  const standIns: HTMLElement[] = [];
  for (const { id } of cards) {
    const handle = (await queryPreviewElements(iframe, `#${id}`))!.matches[0]!.handle;
    const described = (await describePreviewElements(iframe, [handle]))![0]!;
    const standIn = standInFor(iframe, described);
    // As a selection takes it (previewSelection.ts): the stand-in's clip-path is the one the frame reports.
    rememberFrameClipPath(standIn, described.inlineStyles["clip-path"] ?? "", "");
    standIns.push(standIn);
  }
  return standIns;
}

/** A 200 x 100 card painted under `transform` on a frame Studio cannot script, and its stand-in. */
async function sealedCard(transform: string, painted: number[], clip?: string) {
  return (await sealedCards([{ id: "card", transform, painted, clip }]))[0]!;
}

type Shown = { left: number; top: number; width: number; height: number; angle?: number };

/** Studio's crop handles on the stand-in, over the oriented box the frame's geometry gives the selection. */
function cropHandles(standIn: HTMLElement, onStyleCommit = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const show = (shown: Shown, element = standIn) =>
    act(() =>
      root.render(
        createElement(DomEditCropHandles, {
          selection: {
            element,
            id: element.id || "card",
            selector: `#${element.id || "card"}`,
          } as unknown as DomEditSelection,
          overlayRect: { ...shown, editScaleX: 1, editScaleY: 1 },
          onStyleCommit,
        }),
      ),
    );
  const turn = () =>
    document.querySelector<HTMLElement>("[data-dom-edit-crop-frame]")!.style.transform;
  const outline = () =>
    document.querySelector<HTMLElement>("[data-dom-edit-crop-frame] .border-dashed")!.style.width;
  return { root, show, turn, outline };
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

// fails without the fix: before a press, a sealed crop drew its insets at the overlay's zoom alone, as if the card
// had no scale of its own, until a press measured its size.
it("draws a sealed scaled card's crop insets at the card's own scale before any press", async () => {
  const standIn = await sealedCard(
    "matrix(2, 0, 0, 2, 0, 0)",
    [0, 0, 400, 200],
    "inset(0px 20px 0px 0px)",
  );
  const { root, show, outline } = cropHandles(standIn);

  show({ left: 0, top: 0, width: 400, height: 200 });

  await vi.waitFor(() => expect(outline()).toBe("360px"));
  act(() => root.unmount());
});

// fails without the fix: the size read at selection was kept while the card's size changed under it.
it("re-reads a sealed card's size when it changes while selected, before any press", async () => {
  const standIn = await sealedCard(
    "matrix(2, 0, 0, 2, 0, 0)",
    [0, 0, 400, 200],
    "inset(0px 20px 0px 0px)",
  );
  const { root, show, outline } = cropHandles(standIn);
  show({ left: 0, top: 0, width: 400, height: 200 });
  await vi.waitFor(() => expect(outline()).toBe("360px"));

  paint(document.getElementById("card")!, [300, 100], [0, 0, 600, 200]);
  show({ left: 0, top: 0, width: 600, height: 200 });

  await vi.waitFor(() => expect(outline()).toBe("560px"));
  act(() => root.unmount());
});

// fails without the fix: the crop re-read when Studio's playhead moved, before the frame applied the seek, so a seek
// that changed the card's size and scale but kept its painted box drew the old scale (360 px where 380 px is right).
it("re-reads a sealed card's size once the frame shows the seek's time, not when Studio's playhead moves", async () => {
  const standIn = await sealedCard(
    "matrix(2, 0, 0, 2, 0, 0)",
    [0, 0, 400, 200],
    "inset(0px 20px 0px 0px)",
  );
  const { iframe, handle } = previewStandIn(standIn)!;
  const { root, show, outline } = cropHandles(standIn);
  show({ left: 0, top: 0, width: 400, height: 200 });
  await vi.waitFor(() => expect(outline()).toBe("360px"));

  act(() => usePlayerStore.getState().setCurrentTime(3.5));
  // The frame answers in order: anything the playhead move asked is answered, at the old size, before this.
  await previewGeometry(iframe, [handle]);
  paint(document.getElementById("card")!, [400, 200], [0, 0, 400, 200]);
  window.dispatchEvent(
    new MessageEvent("message", {
      source: iframe.contentWindow,
      origin: "null",
      data: { source: "hf-preview", type: "state", currentTime: 3.5, isPlaying: false },
    }),
  );

  await vi.waitFor(() => expect(outline()).toBe("380px"));
  act(() => root.unmount());
});

// fails without the fix: a read sent for a card's first selection, landing after it was selected again, was taken
// over the newer one.
it("draws a card selected again by its newest size, not by a read sent before it was left", async () => {
  const tap = answerTap();
  const [card, other] = await sealedCards(
    [
      {
        id: "card",
        transform: "matrix(2, 0, 0, 2, 0, 0)",
        painted: [0, 0, 400, 200],
        clip: "inset(0px 20px 0px 0px)",
      },
      { id: "other", transform: "none", painted: [500, 0, 200, 100] },
    ],
    { wrapHandedOverPort: tap.wrapHandedOverPort },
  );
  const { root, show, outline } = cropHandles(card!);
  const release = tap.hold(({ kind }) => kind === "gesture-start");
  show({ left: 0, top: 0, width: 400, height: 200 });
  await vi.waitFor(() => expect(tap.held).toHaveLength(1));

  paint(document.getElementById("card")!, [300, 100], [0, 0, 600, 200]);
  show({ left: 500, top: 0, width: 200, height: 100 }, other);
  show({ left: 0, top: 0, width: 600, height: 200 }, card);
  release();

  await vi.waitFor(() => expect(outline()).toBe("560px"));
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

/** Counts the size reads Studio's crop handles send the frame while a resize of the card is live; `end` ends it. */
async function sizeReadsDuringResize(clip?: string) {
  const tap = answerTap();
  let reads = 0;
  tap.hold(({ kind }) => {
    if (kind === "gesture-start") reads += 1;
    return false;
  });
  const [card] = await sealedCards(
    [{ id: "card", transform: "matrix(2, 0, 0, 2, 0, 0)", painted: [0, 0, 400, 200], clip }],
    { wrapHandedOverPort: tap.wrapHandedOverPort },
  );
  const { root, show, outline } = cropHandles(card!);
  show({ left: 0, top: 0, width: 400, height: 200 });
  await vi.waitFor(() => expect(reads).toBe(1));
  const token = beginStudioManualEditGesture(card!, "resize");
  for (const width of [450, 500, 600]) {
    paint(document.getElementById("card")!, [width / 2, 100], [0, 0, width, 200]);
    show({ left: 0, top: 0, width, height: 200 });
    await previewGeometry(previewStandIn(card!)!.iframe, [previewStandIn(card!)!.handle]);
  }
  const live = reads;
  const end = () => act(() => endStudioManualEditGesture(card!, token));
  return { card: card!, live, reads: () => reads, end, outline, root };
}

// fails without the fix: each resize step changed the card's shown size, so the crop handles sent the frame a size
// read per step for a card with no crop, whose handles draw the same at any measured size.
it("sends a sealed uncropped card no size read while a resize is live, and one when it ends", async () => {
  const { live, reads, end, root } = await sizeReadsDuringResize();
  expect(live).toBe(1);
  end();
  await vi.waitFor(() => expect(reads()).toBe(2));
  act(() => root.unmount());
});

// fails without the fix: crop handles closed during the resize still read the card's size when it ended.
it("sends no size read when a resize ends after the sealed card's crop handles closed", async () => {
  const { card, reads, end, root } = await sizeReadsDuringResize();
  act(() => root.unmount());
  end();
  // The frame answers in order, so a read the end sent would be counted before this one is answered.
  const { iframe, handle } = previewStandIn(card)!;
  await previewGeometry(iframe, [handle]);
  expect(reads()).toBe(1);
});

it("keeps reading a sealed cropped card's size while a resize is live, so its insets draw at its own scale", async () => {
  const { live, outline, root } = await sizeReadsDuringResize("inset(0px 20px 0px 0px)");
  expect(live).toBeGreaterThan(1);
  await vi.waitFor(() => expect(outline()).toBe("560px"));
  act(() => root.unmount());
});
