// @vitest-environment happy-dom
import { act, createElement, Fragment, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";
import { previewRequest } from "../../player/lib/previewChannel";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import { useCaptionDetection } from "../../hooks/useCaptionDetection";
import { studioApiFetch } from "../../utils/studioApiFetch";
import type { useCaptionSync } from "../hooks/useCaptionSync";
import { useCaptionStore } from "../store";
import { CaptionOverlay } from "./CaptionOverlay";
import { applyCaptionModelToIframe } from "./CaptionOverlayUtils";
import { CaptionPropertyPanel } from "./CaptionPropertyPanel";

installReactActEnvironment();

const SOURCE = `const TRANSCRIPT = [
  { text: "Hello", start: 0, end: 0.5 },
  { text: "world", start: 0.5, end: 1 },
];`;
vi.mock("../../utils/studioApiFetch", () => ({
  studioApiFetch: vi.fn(async () => ({ json: async () => ({ content: SOURCE }) })),
}));

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  useCaptionStore.getState().reset();
  usePreviewIframeStore.setState({ iframe: null });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

type PortRequest = { id?: unknown; kind?: unknown; params?: unknown };

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  let pick: ((request: PortRequest) => boolean) | null = null;
  const heldIds = new Set<unknown>();
  const held: Array<() => void> = [];
  // Studio's end of the port, so a test can keep the frame's answer to a request until it releases it.
  const tap = (port: MessagePort) => {
    const end = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      postMessage(request: PortRequest) {
        if (pick?.(request)) heldIds.add(request.id);
        port.postMessage(request);
      },
      close: () => port.close(),
    };
    port.onmessage = (event) => {
      const deliver = () => end.onmessage?.(event);
      if (heldIds.has(event.data?.id)) held.push(deliver);
      else deliver();
    };
    return end as unknown as MessagePort;
  };
  const { iframe } = sealedPreviewFrame({ wrapHandedOverPort: tap });
  iframe.style.width = "1920px";
  iframe.getBoundingClientRect = () => new DOMRect(0, 0, 1920, 1080);
  /** Keeps the answers to the requests `match` picks; the returned call hands them to Studio. */
  const hold = (match: (request: PortRequest) => boolean) => {
    pick = match;
    return () => {
      pick = null;
      heldIds.clear();
      held.splice(0).forEach((deliver) => deliver());
    };
  };
  return { iframe, hold, held };
}

/** Settles after one frame round trip, once Studio has acted on every answer it was handed before. */
const frameRoundTrip = (iframe: HTMLIFrameElement) =>
  previewRequest(iframe, "query", { selector: "body" });

const isWrite = ({ kind, params }: PortRequest) =>
  kind === "caption-transform" &&
  (params as { entries: Array<{ set?: unknown }> }).entries.some((entry) => entry.set);

const compIdToSrc = new Map([["captions", "compositions/captions.html"]]);
const captionSync = { loadOverrides: vi.fn() } as unknown as ReturnType<typeof useCaptionSync>;

function CaptionEditor({ iframe }: { iframe: HTMLIFrameElement }) {
  const iframeRef = useRef(iframe);
  useCaptionDetection({
    projectId: "p",
    activeCompPath: "index.html",
    compIdToSrc,
    captionEditMode: false,
    captionHasSelection: false,
    previewIframeRef: iframeRef,
    captionSync,
    setRightCollapsed: () => {},
  });
  const editing = useCaptionStore((s) => s.isEditMode);
  // Studio mounts both only in caption edit mode.
  if (!editing) return null;
  return createElement(
    Fragment,
    null,
    createElement(CaptionOverlay, { iframeRef }),
    createElement(CaptionPropertyPanel, { iframeRef }),
  );
}

const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1 });

const WORDS = `<span class="word">Hello</span> <span class="word">world</span>`;

/** Mounts Studio's caption editing over an opaque frame holding one caption group of `words`. */
function mountEditor(words = WORDS) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.setPointerCapture ??= () => {};
  document.body.innerHTML = `<div data-composition-id="captions" data-width="1920" data-height="1080" data-duration="1">
    <div class="caption-group">${words}</div></div>`;
  const frame = opaqueFrame();
  usePreviewIframeStore.setState({ iframe: frame.iframe });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(CaptionEditor, { iframe: frame.iframe })));
  const unmount = () => act(() => root.unmount());
  closers.push(unmount);
  const boxes = () =>
    [...host.querySelectorAll<HTMLElement>("div.absolute")].filter((el) => el.style.cursor);
  return { ...frame, host, boxes, unmount };
}

async function openEditor(words?: string) {
  const editor = mountEditor(words);
  await vi.waitFor(() => expect(editor.boxes()).toHaveLength(2), { timeout: 3_000 });
  return editor;
}

const styleOf = (segmentId: string) =>
  useCaptionStore.getState().model!.segments.get(segmentId)!.style;

it("caption overlay shows + edits sealed", async () => {
  const { host, boxes } = await openEditor();
  const hello = document.querySelector<HTMLElement>(".word")!;

  act(() => boxes()[0]!.click());
  const segmentId = [...useCaptionStore.getState().selectedSegmentIds][0]!;
  const overlay = boxes()[0]!.parentElement!;
  // The move lands before the frame answers the press's read; it must still draw.
  act(() => void boxes()[0]!.dispatchEvent(pointer("pointerdown", 100, 100)));
  act(() => void overlay.dispatchEvent(pointer("pointermove", 130, 110)));
  act(() => void overlay.dispatchEvent(pointer("pointerup", 130, 110)));
  const transform = () => hello.parentElement!.style.transform;
  await vi.waitFor(() =>
    expect(transform()).toBe("translate(30.0px, 10.0px) rotate(0.0deg) scale(1.000)"),
  );
  await vi.waitFor(() =>
    expect(useCaptionStore.getState().model!.segments.get(segmentId)!.style).toMatchObject({
      x: 30,
      y: 10,
    }),
  );

  const xField = host.querySelector<HTMLInputElement>('input[aria-label="X position"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(xField, "50");
    xField.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await vi.waitFor(() => expect(transform()).toContain("translate(50.0px, 10.0px)"));

  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
  await vi.waitFor(() => expect(transform()).toContain("translate(51.0px, 10.0px)"));

  const model = useCaptionStore.getState().model!;
  const segments = new Map(model.segments);
  segments.set(segmentId, { ...segments.get(segmentId)!, style: { x: 5, y: 6 } });
  applyCaptionModelToIframe({ ...model, segments });
  await vi.waitFor(() => expect(transform()).toContain("translate(5.0px, 6.0px)"));
});

it("a detection still waiting on the frame when Studio unmounts it loads no captions", async () => {
  vi.mocked(studioApiFetch).mockClear();
  const { iframe, hold, held, unmount } = mountEditor();
  // The detection's last question to the frame before it fetches the caption source.
  const release = hold(({ kind, params }) => {
    const selector = (params as { selector?: unknown } | undefined)?.selector;
    return kind === "query" && selector === '[data-composition-id*="caption"]';
  });
  await vi.waitFor(() => expect(held).toHaveLength(1));
  unmount();
  release();
  await frameRoundTrip(iframe);
  expect(studioApiFetch).not.toHaveBeenCalled();
  expect(useCaptionStore.getState()).toMatchObject({ isEditMode: false, model: null });
});

it("a sealed drag the frame answers after the overlay unmounts stores no style", async () => {
  const { iframe, hold, held, boxes, unmount } = await openEditor();
  act(() => boxes()[0]!.click());
  const segmentId = [...useCaptionStore.getState().selectedSegmentIds][0]!;
  const overlay = boxes()[0]!.parentElement!;
  const release = hold(isWrite);
  act(() => void boxes()[0]!.dispatchEvent(pointer("pointerdown", 100, 100)));
  act(() => void overlay.dispatchEvent(pointer("pointermove", 130, 110)));
  act(() => void overlay.dispatchEvent(pointer("pointerup", 130, 110)));
  await vi.waitFor(() => expect(held).toHaveLength(1));
  unmount();
  release();
  await frameRoundTrip(iframe);
  expect(styleOf(segmentId)?.x).toBeUndefined();
});

it("a sealed nudge the frame answers after the overlay unmounts stores no style", async () => {
  const { iframe, hold, held, boxes, unmount } = await openEditor();
  act(() => boxes()[0]!.click());
  const segmentId = [...useCaptionStore.getState().selectedSegmentIds][0]!;
  const release = hold(isWrite);
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })));
  await vi.waitFor(() => expect(held).toHaveLength(1));
  unmount();
  release();
  await frameRoundTrip(iframe);
  expect(styleOf(segmentId)?.x).toBeUndefined();
});

it("a frame word past the write bound is not stored, and a word within it still is", async () => {
  const far = `<span data-caption-wrapper="true" style="display:inline-block; transform: translate(200000px, 0px)"><span class="word">world</span></span>`;
  const { boxes } = await openEditor(`<span class="word">Hello</span> ${far}`);
  const press = (box: HTMLElement, dx: number, dy: number) => {
    act(() => box.click());
    const overlay = box.parentElement!;
    act(() => void box.dispatchEvent(pointer("pointerdown", 100, 100)));
    if (dx || dy) act(() => void overlay.dispatchEvent(pointer("pointermove", 100 + dx, 100 + dy)));
    act(() => void overlay.dispatchEvent(pointer("pointerup", 100 + dx, 100 + dy)));
    return [...useCaptionStore.getState().selectedSegmentIds][0]!;
  };
  // A press and release with no move stores where the frame says the word is.
  const farWord = press(boxes()[1]!, 0, 0);
  const nearWord = press(boxes()[0]!, 30, 10);
  // The frame answers in order, so the far word's answer was handled before this one's.
  await vi.waitFor(() => expect(styleOf(nearWord)).toMatchObject({ x: 30, y: 10 }));
  expect(styleOf(farWord)?.x).toBeUndefined();
});
