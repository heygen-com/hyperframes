// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MotionPathOverlay } from "./MotionPathOverlay";
import { usePlayerStore } from "../../player/store/playerStore";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import type { DomEditSelection } from "./domEditing";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({ selectedGsapAnimations: [] }),
}));
vi.mock("./motionPathSelection", () => ({
  selectorFor: () => "#box",
  editableAnimationId: () => null,
}));
vi.mock("./useMotionPathData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useMotionPathData")>()),
  useMotionPathData: () => ({
    rect: null,
    geometry: null,
    geometryResolved: true,
    visibleInPreview: true,
    home: null,
    pScale: 1,
  }),
}));

it("re-evaluates set-destination availability when a reload swaps the live iframe", () => {
  const host = document.createElement("div");
  const before = document.createElement("iframe");
  const after = document.createElement("iframe");
  document.body.append(host, before, after);
  Reflect.set(after.contentWindow as object, "MotionPathPlugin", {});
  const ref = { current: before };
  const root = createRoot(host);
  const selection = { element: document.createElement("div") } as unknown as DomEditSelection;
  try {
    act(() => usePreviewIframeStore.getState().setIframe(before));
    act(() =>
      root.render(
        <MotionPathOverlay
          iframeRef={ref}
          selection={selection}
          compositionSize={{ width: 1920, height: 1080 }}
          isPlaying={false}
        />,
      ),
    );
    expect(usePlayerStore.getState().motionPathCreateAvailable).toBe(false);

    act(() => {
      usePreviewIframeStore.getState().setIframe(after);
    });
    expect(usePlayerStore.getState().motionPathCreateAvailable).toBe(true);
  } finally {
    act(() => root.unmount());
    usePreviewIframeStore.setState({ iframe: null });
    host.remove();
    before.remove();
    after.remove();
  }
});
