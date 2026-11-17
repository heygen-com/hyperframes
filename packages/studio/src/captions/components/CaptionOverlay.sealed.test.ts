// @vitest-environment happy-dom
import { act, createElement, Fragment, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installEditingAgent } from "../../../../core/src/runtime/editingAgent";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import { detachedFakeIframe } from "../../player/hooks/timelinePlayerTestHarness";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import { useCaptionDetection } from "../../hooks/useCaptionDetection";
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

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame() {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  iframe.style.width = "1920px";
  iframe.getBoundingClientRect = () => new DOMRect(0, 0, 1920, 1080);
  return iframe;
}

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

it("caption overlay shows + edits sealed", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.setPointerCapture ??= () => {};
  document.body.innerHTML = `<div data-composition-id="captions" data-width="1920" data-height="1080" data-duration="1">
    <div class="caption-group"><span class="word">Hello</span> <span class="word">world</span></div></div>`;
  const hello = document.querySelector<HTMLElement>(".word")!;
  const iframe = opaqueFrame();
  usePreviewIframeStore.setState({ iframe });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(CaptionEditor, { iframe })));
  closers.push(() => act(() => root.unmount()));

  const boxes = () =>
    [...host.querySelectorAll<HTMLElement>("div.absolute")].filter((el) => el.style.cursor);
  await vi.waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 3_000 });

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
