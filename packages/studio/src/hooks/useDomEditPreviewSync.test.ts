// @vitest-environment happy-dom

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import { announcePreviewDocumentLoaded, sceneSwapFor } from "../player/sceneSwap";
import type { DomEditSelection } from "../components/editor/domEditing";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useDomEditPreviewSync", () => {
  it("re-syncs the preview when edited scenes are swapped in, and not when the swap is refused", async () => {
    const iframe = document.createElement("iframe");
    let refuse = false;
    Object.defineProperty(iframe, "contentWindow", {
      value: {
        __hfSwapScenes: async () => {
          if (refuse) throw new Error("the film changed outside its scenes");
        },
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(""));
    const applyManualEdits = vi.fn(async () => {});
    const refreshVersion = vi.fn();
    function Harness() {
      useDomEditPreviewSync({
        previewIframe: iframe,
        captionEditMode: false,
        domEditSelectionRef: { current: null },
        domEditSelection: null,
        refreshDomEditSelectionFromPreview: async () => {},
        refreshPreviewDocumentVersion: refreshVersion,
        syncPreviewHotkeys: () => {},
        applyStudioManualEditsToPreviewRef: { current: applyManualEdits },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness)));
    applyManualEdits.mockClear();
    refreshVersion.mockClear();

    refuse = true;
    await act(() => sceneSwapFor(iframe)!("/preview", () => true).catch(() => {}));
    expect(refreshVersion).not.toHaveBeenCalled();

    refuse = false;
    await act(() => sceneSwapFor(iframe)!("/preview", () => true));
    expect(applyManualEdits).toHaveBeenCalledWith(iframe);
    expect(refreshVersion).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    fetchSpy.mockRestore();
  });

  it("re-resolves the selection when a sealed preview loads a new page", () => {
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", { value: null });
    Object.defineProperty(iframe, "contentWindow", {
      value: {
        get document() {
          throw new DOMException("blocked", "SecurityError");
        },
      },
    });
    const selection = { selector: "#target", handle: "old-page:1" } as DomEditSelection;
    const refresh = vi.fn(async () => {});
    function Harness() {
      useDomEditPreviewSync({
        previewIframe: iframe,
        captionEditMode: false,
        domEditSelectionRef: { current: selection },
        domEditSelection: selection,
        refreshDomEditSelectionFromPreview: refresh,
        refreshPreviewDocumentVersion: () => {},
        syncPreviewHotkeys: () => {},
        applyStudioManualEditsToPreviewRef: { current: async () => {} },
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Harness)));
    refresh.mockClear();

    act(() => announcePreviewDocumentLoaded(iframe));
    expect(refresh).toHaveBeenCalledWith(selection, iframe);
    act(() => root.unmount());
  });
});
