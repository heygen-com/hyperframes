// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useSlideshowTabState } from "./useSlideshowTabState";
import type { RightPanelTab } from "../utils/studioHelpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLIDESHOW_HTML = `<html><body><script type="application/hyperframes-slideshow+json">{"slides":[]}</script></body></html>`;
const PLAIN_HTML = `<html><body><div id="title">hi</div></body></html>`;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderHook(params: {
  editingFileContent: string | null | undefined;
  rightPanelTab: RightPanelTab;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const setRightPanelTabCalls: RightPanelTab[] = [];
  let current: ReturnType<typeof useSlideshowTabState> | null = null;

  function Harness() {
    current = useSlideshowTabState({
      editingFileContent: params.editingFileContent,
      previewIframeRef: { current: null },
      refreshKey: 0,
      rightPanelTab: params.rightPanelTab,
      setRightPanelTab: (tab) => setRightPanelTabCalls.push(tab),
    });
    return null;
  }

  act(() => {
    root.render(React.createElement(Harness));
  });

  return {
    getState: (): ReturnType<typeof useSlideshowTabState> => {
      if (!current) throw new Error("useSlideshowTabState did not render");
      return current;
    },
    setRightPanelTabCalls,
    unmount: () => act(() => root.unmount()),
  };
}

describe("useSlideshowTabState", () => {
  it("detects a slideshow composition via the JSON island", () => {
    const harness = renderHook({ editingFileContent: SLIDESHOW_HTML, rightPanelTab: "design" });
    expect(harness.getState().isSlideshowComposition).toBe(true);
    harness.unmount();
  });

  it("reports false for a plain (non-slideshow) composition", () => {
    const harness = renderHook({ editingFileContent: PLAIN_HTML, rightPanelTab: "design" });
    expect(harness.getState().isSlideshowComposition).toBe(false);
    harness.unmount();
  });

  it("reports false when there is no editing file yet", () => {
    const harness = renderHook({ editingFileContent: undefined, rightPanelTab: "design" });
    expect(harness.getState().isSlideshowComposition).toBe(false);
    harness.unmount();
  });

  it("still detects a malformed island — presence-only, not full manifest validation", () => {
    const malformed = `<html><body><script type="application/hyperframes-slideshow+json">{not valid json</script></body></html>`;
    const harness = renderHook({ editingFileContent: malformed, rightPanelTab: "design" });
    expect(harness.getState().isSlideshowComposition).toBe(true);
    harness.unmount();
  });

  it("bounces rightPanelTab off 'slideshow' to 'renders' on a non-slideshow composition", () => {
    const harness = renderHook({ editingFileContent: PLAIN_HTML, rightPanelTab: "slideshow" });
    expect(harness.setRightPanelTabCalls).toEqual(["renders"]);
    harness.unmount();
  });

  it("does not bounce when the composition is a slideshow", () => {
    const harness = renderHook({ editingFileContent: SLIDESHOW_HTML, rightPanelTab: "slideshow" });
    expect(harness.setRightPanelTabCalls).toEqual([]);
    harness.unmount();
  });

  it("does not bounce a tab other than 'slideshow'", () => {
    const harness = renderHook({ editingFileContent: PLAIN_HTML, rightPanelTab: "renders" });
    expect(harness.setRightPanelTabCalls).toEqual([]);
    harness.unmount();
  });
});
