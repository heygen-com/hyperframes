// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMotionPathData } from "./useMotionPathData";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nativeRequestAnimationFrame = globalThis.requestAnimationFrame;

/**
 * The measurement loop must be silent when nothing moves AND correct when
 * something does. The second half is the hazard the parked shape introduces:
 * a loop that parks and is never re-armed leaves a stale motion path.
 */
type Measured = ReturnType<typeof useMotionPathData>;

let root: Root | null = null;
let host: HTMLDivElement;
let iframe: HTMLIFrameElement;
let latest: Measured;
let scheduled: number;

// Stable across renders, exactly like the app's `useRef` — a fresh object every
// render would re-run the effect and hide the parking this file is about.
const iframeRef: { current: HTMLIFrameElement | null } = { current: null };

function Probe({ selector }: { selector: string | null }) {
  latest = useMotionPathData(iframeRef, selector);
  return null;
}

function previewDoc(): Document {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("the test iframe has no document");
  return doc;
}

function render(selector: string | null): void {
  act(() => {
    root!.render(<Probe selector={selector} />);
  });
}

/** Let the loop run: several real frames, flushing React between them. */
async function settle(frames = 6): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => nativeRequestAnimationFrame(() => resolve()));
    });
  }
}

beforeEach(() => {
  scheduled = 0;
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    scheduled += 1;
    return nativeRequestAnimationFrame(callback);
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  iframeRef.current = iframe;
  previewDoc().body.innerHTML = `<div id="target"></div>`;
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  iframe.remove();
  iframeRef.current = null;
  globalThis.requestAnimationFrame = nativeRequestAnimationFrame;
});

describe("useMotionPathData", () => {
  it("parks instead of measuring every frame while a selection is active", async () => {
    render("#target");
    await settle();
    const afterFirstBurst = scheduled;

    await settle(10);

    // A 60Hz loop would have added ten frames here; a parked one adds none.
    expect(scheduled).toBe(afterFirstBurst);
  });

  it("schedules nothing at all with no selection", async () => {
    render(null);
    await settle(10);

    expect(scheduled).toBe(0);
  });

  it("re-arms when the preview document changes, so the path is never stale", async () => {
    render("#target");
    await settle();
    expect(latest.visibleInPreview).toBe(true);
    const parked = scheduled;

    // A seek, an edit or a GSAP frame — all of them land as a style write.
    act(() => {
      previewDoc().getElementById("target")!.style.display = "none";
    });
    await settle();

    expect(scheduled).toBeGreaterThan(parked);
    expect(latest.visibleInPreview).toBe(false);
  });

  it("picks up a target that only appears after the loop has parked", async () => {
    previewDoc().body.innerHTML = "";
    render("#late");
    await settle();
    expect(latest.home).toBeNull();

    act(() => {
      previewDoc().body.innerHTML = `<div id="late"></div>`;
    });
    await settle();

    expect(latest.home).not.toBeNull();
  });

  it("stops scheduling once the selection is cleared", async () => {
    render("#target");
    await settle();
    render(null);
    await settle();
    const afterClear = scheduled;

    act(() => {
      previewDoc().getElementById("target")!.style.display = "none";
    });
    await settle(10);

    expect(scheduled).toBe(afterClear);
  });
});
