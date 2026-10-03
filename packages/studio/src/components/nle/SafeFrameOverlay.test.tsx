/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { overlayRectsForSafeFrames, SafeFrameOverlay } from "./SafeFrameOverlay";
import { writeStudioUiPreferences } from "../../utils/studioUiPreferences";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VERTICAL = {
  id: "vertical",
  ratio: "9:16" as const,
  x: (1920 - 608) / 2 / 1920,
  y: 0,
  width: 608 / 1920,
  height: 1,
};

describe("overlayRectsForSafeFrames", () => {
  it("maps pixel rects onto the iframe box in the Studio overlay", () => {
    const rects = overlayRectsForSafeFrames(
      [VERTICAL],
      { width: 1920, height: 1080 },
      { left: 100, top: 50, width: 1920, height: 1080 },
      { left: 100, top: 50 },
    );
    expect(rects).toEqual([{ id: "vertical", left: 656, top: 0, width: 608, height: 1080 }]);
  });
});

describe("SafeFrameOverlay", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;
  const iframeRef: { current: HTMLIFrameElement | null } = { current: null };

  function mount(): void {
    host = document.createElement("div");
    document.body.append(host);
    iframeRef.current = document.createElement("iframe");
    document.body.append(iframeRef.current);
    const doc = iframeRef.current.contentDocument;
    doc?.open();
    doc?.write(
      `<!doctype html><div id="root" data-composition-id="launch" data-width="1920" data-height="1080" data-safe-frames='${JSON.stringify([VERTICAL])}'></div>`,
    );
    doc?.close();
    writeStudioUiPreferences({ safeFramesVisible: true });
    root = createRoot(host);
    act(() => {
      root?.render(<SafeFrameOverlay iframeRef={iframeRef} />);
    });
  }

  afterEach(() => {
    if (root) act(() => root?.unmount());
    root = null;
    host = null;
    iframeRef.current = null;
    document.body.replaceChildren();
    window.localStorage.clear();
  });

  it("draws overlay rects in the Studio document, not the iframe", () => {
    mount();
    expect(host?.querySelector("[data-safe-frame-overlay]")).not.toBeNull();
    expect(
      iframeRef.current?.contentDocument?.querySelector("[data-safe-frame-overlay]"),
    ).toBeNull();
  });

  it("removes overlay rects from the Studio document when the toggle is off", () => {
    mount();
    const toggle = host?.querySelector("[data-safe-frame-toggle]");
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host?.querySelector("[data-safe-frame-overlay]")).toBeNull();
    expect(host?.querySelector("[data-safe-frame-id]")).toBeNull();
  });
});
