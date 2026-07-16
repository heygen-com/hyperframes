// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCaptionSync } from "../captions/hooks/useCaptionSync";
import { useCaptionStore } from "../captions/store";
import { useCaptionDetection } from "./useCaptionDetection";

vi.mock("../captions/parser", () => ({
  parseCaptionComposition: () => ({
    width: 1920,
    height: 1080,
    duration: 10,
    segments: new Map(),
    groups: new Map(),
    groupOrder: [],
  }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

beforeEach(() => {
  useCaptionStore.getState().reset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  useCaptionStore.getState().reset();
  vi.unstubAllGlobals();
});

async function settleDetection(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe("useCaptionDetection", () => {
  it("keeps explicit caption mode exit sticky for the mounted Studio session", async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ content: "caption composition source" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const iframeDocument = iframe.contentDocument;
    if (!iframeDocument) throw new Error("iframe document unavailable");
    iframeDocument.body.innerHTML = `
      <div data-composition-id="captions" data-width="1920" data-height="1080" data-duration="10">
        <div data-composition-src="captions.html">
          <span class="caption-group"></span>
        </div>
      </div>
    `;

    const previewIframeRef = { current: iframe };
    const compIdToSrc = new Map([["captions", "captions.html"]]);
    const setRightCollapsed = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    function Harness({ activeCompPath }: { activeCompPath: string }) {
      const captionEditMode = useCaptionStore((state) => state.isEditMode);
      const captionHasSelection = useCaptionStore((state) => state.selectedSegmentIds.size > 0);
      const captionSync = useCaptionSync(null);
      const exitCaptionMode = useCaptionDetection({
        projectId: "project-1",
        activeCompPath,
        compIdToSrc,
        captionEditMode,
        captionHasSelection,
        previewIframeRef,
        captionSync,
        setRightCollapsed,
      });
      return (
        <button type="button" onClick={exitCaptionMode}>
          {captionEditMode ? "Caption mode" : "Normal inspector"}
        </button>
      );
    }

    act(() => root?.render(<Harness activeCompPath="captions.html" />));
    await settleDetection();

    expect(useCaptionStore.getState().isEditMode).toBe(true);
    const exitButton = document.querySelector("button");
    if (!(exitButton instanceof HTMLButtonElement)) throw new Error("exit button not rendered");
    act(() => exitButton.click());

    expect(useCaptionStore.getState().isEditMode).toBe(false);
    expect(setRightCollapsed).toHaveBeenLastCalledWith(false);

    act(() => root?.render(<Harness activeCompPath="alternate-captions.html" />));
    await settleDetection();

    expect(useCaptionStore.getState().isEditMode).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
