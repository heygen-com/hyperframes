// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Root } from "react-dom/client";
import type { TimelineElement } from "../player";
import { useTimelineGroupEditing } from "./useTimelineGroupEditing";
import { installReactActEnvironment, mountReactHarness } from "./domSelectionTestHarness";

installReactActEnvironment();

function el(id: string, start: number, duration: number, track = 0): TimelineElement {
  return { id, tag: "video", start, duration, track, domId: id };
}

describe("useTimelineGroupEditing: handleTimelineGroupMove suppressFailureToast", () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  type GroupEditingOptions = Parameters<typeof useTimelineGroupEditing>[0];

  // No project id makes enqueueGroupOperation reject before any persist runs,
  // exercising the move's real catch block without faking the SDK/server path.
  function mountFailingHarness(showToast: GroupEditingOptions["showToast"]) {
    let hook: ReturnType<typeof useTimelineGroupEditing> | null = null;
    function Harness() {
      hook = useTimelineGroupEditing({
        activeCompPath: "index.html",
        editQueueRef: { current: Promise.resolve() },
        pendingTimelineEditPathRef: { current: new Set() },
        previewIframeRef: { current: null },
        projectIdRef: { current: null },
        recordEdit: vi.fn().mockResolvedValue(undefined),
        reloadPreview: vi.fn(),
        showToast,
        writeProjectFile: vi.fn().mockResolvedValue(undefined),
      });
      return null;
    }
    root = mountReactHarness(<Harness />);
    return () => hook!;
  }

  const change = { element: el("a", 0, 2), start: 2 };

  it("shows no toast when suppressFailureToast is set on a failed move", async () => {
    const showToast = vi.fn();
    const getHook = mountFailingHarness(showToast);

    await act(async () => {
      await expect(
        getHook().handleTimelineGroupMove([change], { suppressFailureToast: true }),
      ).rejects.toThrow();
    });

    expect(showToast).not.toHaveBeenCalled();
  });

  it("shows one toast when suppressFailureToast is not set on a failed move", async () => {
    const showToast = vi.fn();
    const getHook = mountFailingHarness(showToast);

    await act(async () => {
      await expect(getHook().handleTimelineGroupMove([change])).rejects.toThrow();
    });

    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
