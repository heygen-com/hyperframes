// @vitest-environment happy-dom

import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useDomEditPreviewSync } from "./useDomEditPreviewSync";
import {
  announcePreviewDocumentLoaded,
  announcePreviewRestoredInPlace,
  sceneSwapFor,
} from "../player/sceneSwap";
import { findElementForSelection, type DomEditSelection } from "../components/editor/domEditing";
import { makePreview } from "../player/hooks/timelinePlayerTestHarness";
import { applyUndoRestoreToPreview } from "../utils/gsapUndoRestore";
import { withInlineLayoutBox } from "./domSelectionTestHarness";

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

  // fails without the fix: an undo the sealed frame restored in place left the selection as it was before.
  it.each([
    ["loads a new page", announcePreviewDocumentLoaded],
    ["restores an undo in place", announcePreviewRestoredInPlace],
  ])("re-resolves the selection when a sealed preview %s", async (_label, announce) => {
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

    await act(async () => announce(iframe));
    expect(refresh).toHaveBeenCalledWith(selection, iframe);
    act(() => root.unmount());
  });

  const film = (title: string, other: string) =>
    `<h1 id="title" style="${title}; width: 200px; height: 50px">Title</h1><div id="other" style="${other}">o</div>`;

  // The selection re-read an unsealed in-place undo now triggers keeps who is selected and where it is drawn.
  it.each([
    ["another layer", "translate: 30px 40px", "left: 0px", "30px 40px"],
    ["the selected layer", "translate: 0px 0px", "left: 10px", "0px 0px"],
  ])(
    "keeps the selection and its box when an unsealed undo of %s lands in place",
    async (_name, restoredTitle, restoredOther, drawn) => {
      const iframe = makePreview(film("translate: 30px 40px", "left: 10px"));
      const doc = iframe.contentDocument!;
      const title = withInlineLayoutBox(doc.getElementById("title")!);
      const selectionRef = {
        current: { element: title, id: "title", selector: "#title" } as unknown as DomEditSelection,
      };
      const refresh = vi.fn(async (selection: DomEditSelection, frame: HTMLIFrameElement) => {
        const element = findElementForSelection(frame.contentDocument!, selection, null);
        selectionRef.current = element ? ({ ...selection, element } as DomEditSelection) : null;
      });
      function Harness() {
        useDomEditPreviewSync({
          previewIframe: iframe,
          captionEditMode: false,
          domEditSelectionRef: selectionRef,
          domEditSelection: selectionRef.current,
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

      const page = (body: string) => `<html><body>${body}</body></html>`;
      const files = {
        "index.html": {
          previous: page(film("translate: 30px 40px", "left: 10px")),
          restored: page(film(restoredTitle, restoredOther)),
        },
      };
      await act(
        async () => void applyUndoRestoreToPreview(iframe, "index.html", files, 1, vi.fn()),
      );

      expect(refresh).toHaveBeenCalledOnce();
      expect(selectionRef.current?.element).toBe(title);
      expect([title.style.translate, title.offsetWidth, title.offsetHeight]).toEqual([
        drawn,
        200,
        50,
      ]);
      act(() => root.unmount());
    },
  );
});
