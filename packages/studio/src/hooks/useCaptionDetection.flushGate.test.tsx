// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCaptionDetection } from "./useCaptionDetection";
import { useCaptionStore } from "../captions/store";
import type { useCaptionSync } from "../captions/hooks/useCaptionSync";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// projectId: null keeps this to the composition-switch flush effect only —
// the caption-activation effect bails immediately without a project id, so
// no iframe/DOM mocking is needed for it.
function mountDetection(initialCompPath: string | null) {
  let setActiveCompPath: (path: string | null) => void = () => {};
  function Probe({ activeCompPath }: { activeCompPath: string | null }) {
    useCaptionDetection({
      projectId: null,
      activeCompPath,
      compIdToSrc: new Map(),
      captionEditMode: false,
      captionHasSelection: false,
      previewIframeRef: { current: null },
      captionSync: {} as ReturnType<typeof useCaptionSync>,
      setRightCollapsed: () => {},
    });
    return null;
  }

  const root = createRoot(document.createElement("div"));
  function render(path: string | null) {
    act(() => root.render(<Probe activeCompPath={path} />));
  }
  setActiveCompPath = render;
  render(initialCompPath);
  return { root, setActiveCompPath };
}

describe("useCaptionDetection composition-switch flush", () => {
  afterEach(() => {
    useCaptionStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("does not call retrySave when there is no pending edit", () => {
    const retrySave = vi.fn();
    const store = useCaptionStore.getState();
    store.setModel({} as never);
    store.setRetrySave(retrySave);
    store.setHasPendingSave(false);

    const { root, setActiveCompPath } = mountDetection("comp-a.html");
    setActiveCompPath("comp-b.html");

    expect(retrySave).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("calls retrySave when an edit is pending", () => {
    const retrySave = vi.fn();
    const store = useCaptionStore.getState();
    store.setModel({} as never);
    store.setRetrySave(retrySave);
    store.setHasPendingSave(true);

    const { root, setActiveCompPath } = mountDetection("comp-a.html");
    setActiveCompPath("comp-b.html");

    expect(retrySave).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("still resets caption state on switch even when nothing was pending", () => {
    const store = useCaptionStore.getState();
    store.setModel({} as never);
    store.setEditMode(true);
    store.setHasPendingSave(false);

    const { root, setActiveCompPath } = mountDetection("comp-a.html");
    setActiveCompPath("comp-b.html");

    expect(useCaptionStore.getState().model).toBeNull();
    expect(useCaptionStore.getState().isEditMode).toBe(false);
    act(() => root.unmount());
  });
});
