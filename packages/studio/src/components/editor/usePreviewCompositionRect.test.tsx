// @vitest-environment happy-dom

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import {
  usePreviewCompositionRect,
  type PreviewCompositionRect,
} from "./usePreviewCompositionRect";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  usePreviewIframeStore.getState().setIframe(null);
  document.body.innerHTML = "";
});

function boxed<T extends HTMLElement>(el: T, box: [number, number, number, number]): T {
  const [left, top, width, height] = box;
  el.getBoundingClientRect = () => new DOMRect(left, top, width, height);
  return el;
}

function mountProbe() {
  let rect: PreviewCompositionRect | undefined;
  function Probe() {
    const ref = useRef<HTMLDivElement>(null);
    rect = usePreviewCompositionRect(ref);
    return (
      <div
        ref={(el) => {
          ref.current = el;
          if (el) boxed(el, [10, 20, 1000, 600]);
        }}
      />
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<Probe />));
  return () => rect;
}

function compositionFrame(box: [number, number, number, number], width: number, height: number) {
  const iframe = boxed(document.createElement("iframe"), box);
  document.body.append(iframe);
  const root = iframe.contentDocument?.createElement("div");
  root?.setAttribute("data-composition-id", "main");
  root?.setAttribute("data-width", String(width));
  root?.setAttribute("data-height", String(height));
  if (root) iframe.contentDocument?.body.append(root);
  return iframe;
}

const settle = () => new Promise((r) => setTimeout(r, 400));

describe("usePreviewCompositionRect", () => {
  it("reports the live preview iframe's box relative to the overlay, scaled to the composition", async () => {
    const read = mountProbe();
    const iframe = compositionFrame([110, 70, 960, 540], 1920, 1080);
    await act(async () => {
      usePreviewIframeStore.getState().setIframe(iframe);
      await settle();
    });
    expect(read()).toEqual({
      left: 100,
      top: 50,
      width: 960,
      height: 540,
      scaleX: 0.5,
      scaleY: 0.5,
    });
  });

  it("follows the iframe when a reload replaces it", async () => {
    const read = mountProbe();
    await act(async () => {
      usePreviewIframeStore.getState().setIframe(compositionFrame([110, 70, 960, 540], 1920, 1080));
      await settle();
    });
    await act(async () => {
      usePreviewIframeStore.getState().setIframe(compositionFrame([60, 40, 500, 500], 1000, 1000));
      await settle();
    });
    expect(read()).toEqual({
      left: 50,
      top: 20,
      width: 500,
      height: 500,
      scaleX: 0.5,
      scaleY: 0.5,
    });
  });
});
