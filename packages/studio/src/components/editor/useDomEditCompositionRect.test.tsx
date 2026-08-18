// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useDomEditCompositionRect } from "./useDomEditCompositionRect";
import type { OverlayFrameLoop } from "./overlayFrameLoop";
import {
  countScheduledFrames,
  flushAnimationFrames,
  pinWeakRefStrong,
  restoreAnimationFrameCounter,
  testDomRect as domRect,
  unpinWeakRef,
} from "./overlayLoopTestKit";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

beforeAll(pinWeakRefStrong);
afterAll(unpinWeakRef);

const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  restoreAnimationFrameCounter();
});

// happy-dom's ResizeObserver never delivers, so the observed elements and the
// callback are captured here and fired by hand — the wiring is what matters.
const resizeObservers: { targets: Element[]; fire: () => void }[] = [];
const RealResizeObserver = globalThis.ResizeObserver;
class RecordingResizeObserver {
  targets: Element[] = [];
  constructor(callback: () => void) {
    resizeObservers.push({ targets: this.targets, fire: callback });
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = RecordingResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = RealResizeObserver;
});

interface Harness {
  stage: HTMLDivElement;
  iframe: HTMLIFrameElement;
  loopRef: { current: OverlayFrameLoop | null };
  iframeWidth: () => number;
  setIframeWidth: (value: number) => void;
  layoutReads: () => number;
  readScaleX: () => number;
}

function mountHook(): Harness {
  const stage = document.createElement("div");
  const iframe = document.createElement("iframe");
  stage.append(iframe);
  document.body.append(stage);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("Expected iframe content document");
  doc.body.innerHTML = `<div data-composition-id="root" data-width="800" data-height="450"></div>`;

  const overlay = document.createElement("div");
  document.body.append(overlay);

  let width = 800;
  let reads = 0;
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    reads += 1;
    if (this === iframe) return domRect(0, 0, width, 450);
    return domRect(0, 0, 1000, 600);
  };

  let scaleX = 0;
  const loopRef: { current: OverlayFrameLoop | null } = { current: null };
  function Probe(): React.ReactElement {
    const rect = useDomEditCompositionRect({
      iframeRef: { current: iframe },
      overlayRef: { current: overlay },
      loopRef,
    });
    scaleX = rect.scaleX;
    return <span>{rect.width}</span>;
  }

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Probe />));

  return {
    stage,
    iframe,
    loopRef,
    iframeWidth: () => width,
    setIframeWidth: (value: number) => {
      width = value;
    },
    layoutReads: () => reads,
    readScaleX: () => scaleX,
  };
}

describe("useDomEditCompositionRect", () => {
  it("reads no layout and schedules no frame at idle", async () => {
    const harness = mountHook();
    await flushAnimationFrames(4);

    const settled = harness.layoutReads();
    expect(settled).toBeGreaterThan(0);

    const scheduled = countScheduledFrames();
    await flushAnimationFrames(10);
    expect(harness.layoutReads()).toBe(settled);
    expect(scheduled()).toBe(0);
  });

  it("re-measures when the iframe loads another composition", async () => {
    const harness = mountHook();
    await flushAnimationFrames(4);
    const settled = harness.layoutReads();

    harness.setIframeWidth(400);
    act(() => {
      harness.iframe.dispatchEvent(new Event("load"));
    });
    await flushAnimationFrames(3);

    expect(harness.layoutReads()).toBeGreaterThan(settled);
    expect(harness.readScaleX()).toBeCloseTo(0.5, 5);
  });

  it("re-measures when refreshOverlayGeometry re-arms it", async () => {
    const harness = mountHook();
    await flushAnimationFrames(4);
    const settled = harness.layoutReads();

    // The stand-in for a preview iframe swap: nothing observable happened in
    // this hook, DomEditOverlay simply armed the loop it was handed.
    harness.setIframeWidth(1600);
    act(() => harness.loopRef.current?.arm());
    await flushAnimationFrames(3);

    expect(harness.layoutReads()).toBeGreaterThan(settled);
    expect(harness.readScaleX()).toBeCloseTo(2, 5);
  });

  it("re-measures when the iframe or overlay resizes", async () => {
    resizeObservers.length = 0;
    const harness = mountHook();
    await flushAnimationFrames(4);
    const settled = harness.layoutReads();
    const observer = resizeObservers.at(-1);
    if (!observer) throw new Error("Expected a ResizeObserver on the iframe and overlay");
    expect(observer.targets).toContain(harness.iframe);
    expect(observer.targets.length).toBe(2);

    harness.setIframeWidth(1600);
    act(() => observer.fire());
    await flushAnimationFrames(3);

    expect(harness.layoutReads()).toBeGreaterThan(settled);
    expect(harness.readScaleX()).toBeCloseTo(2, 5);
  });

  it("re-measures when the preview stage's transform changes", async () => {
    const harness = mountHook();
    await flushAnimationFrames(4);
    expect(harness.readScaleX()).toBeCloseTo(1, 5);
    const settled = harness.layoutReads();

    // Zooming writes `transform` on an ancestor of the iframe — a change no
    // ResizeObserver reports, because the iframe's layout box is unchanged.
    harness.setIframeWidth(1600);
    harness.stage.style.transform = "scale(2)";
    await flushAnimationFrames(4);

    expect(harness.layoutReads()).toBeGreaterThan(settled);
    expect(harness.readScaleX()).toBeCloseTo(2, 5);
  });
});
