// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MotionPathOverlay } from "./MotionPathOverlay";
import { usePlayerStore } from "../../player/store/playerStore";
import { usePreviewIframeStore } from "../../player/store/previewIframeStore";
import type { DomEditSelection } from "./domEditing";
import { commitCreatePath } from "./motionPathCommit";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const POLLED = { x: 0, y: 0, w: 100, h: 50, ax: 0.5, ay: 0.5 };
const AT_CLICK = { x: 500, y: 300, w: 100, h: 50, ax: 0.5, ay: 0.5 };

vi.mock("../../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({ selectedGsapAnimations: [] }),
}));
vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewFrameOpaque: () => true,
}));
vi.mock("./motionPathCommit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./motionPathCommit")>()),
  commitCreatePath: vi.fn(),
}));
vi.mock("./motionPathSelection", () => ({
  selectorFor: () => "#box",
  editableAnimationId: () => null,
}));
vi.mock("./useMotionPathData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useMotionPathData")>()),
  hasMotionPathPlugin: () => true,
  sealedMotionPathHome: vi.fn(async () => ({
    home: AT_CLICK,
    perspective: 1,
    visible: true,
    plugin: true,
  })),
  useMotionPathData: () => ({
    rect: { left: 0, top: 0, width: 1920, height: 1080 },
    geometry: null,
    geometryResolved: true,
    visibleInPreview: true,
    home: POLLED,
    pScale: 1,
  }),
}));

// fails without the fix: a sealed click placed the path from the last poll's home, maybe the previous playhead's.
it("places a sealed preview's new path from the layer's home read at the click", async () => {
  const host = document.createElement("div");
  const surface = document.createElement("div");
  surface.setAttribute("data-preview-pan-surface", "");
  const frame = document.createElement("iframe");
  document.body.append(host, surface, frame);
  frame.getBoundingClientRect = () => new DOMRect(0, 0, 1920, 1080);
  const root = createRoot(host);
  const selection = { element: document.createElement("div") } as unknown as DomEditSelection;
  try {
    act(() => usePreviewIframeStore.getState().setIframe(frame));
    act(() =>
      root.render(
        <MotionPathOverlay
          iframeRef={{ current: frame }}
          selection={selection}
          compositionSize={{ width: 1920, height: 1080 }}
          isPlaying={false}
        />,
      ),
    );
    act(() => usePlayerStore.getState().setMotionPathArmed(true));
    const press = { bubbles: true, button: 0, clientX: 600, clientY: 400 };
    await act(async () => void surface.dispatchEvent(new PointerEvent("pointerdown", press)));

    expect(vi.mocked(commitCreatePath).mock.calls[0]?.slice(0, 4)).toEqual(["#box", 0, 100, 100]);
  } finally {
    act(() => usePlayerStore.getState().setMotionPathArmed(false));
    act(() => root.unmount());
    usePreviewIframeStore.setState({ iframe: null });
    host.remove();
    surface.remove();
    frame.remove();
  }
});
