// @vitest-environment jsdom
import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player/store/playerStore";
import { makeSelection, mountReactHarness } from "./domSelectionTestHarness";
import { useGestureCommit } from "./useGestureCommit";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
  document.body.replaceChildren();
});

describe("gesture recording filter sampling", () => {
  it.each([
    { frames: 1, throws: "none" },
    { frames: 2, throws: "none" },
    { frames: 1, throws: "seek" },
    { frames: 1, throws: "set" },
  ])(
    "borrows the preview document for $frames frames (throws=$throws) then exits without a reload",
    async ({ frames, throws }) => {
      const queue: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
        queue.push(callback),
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      let nowMs = 0;
      vi.spyOn(performance, "now").mockImplementation(() => nowMs);
      const iframe = document.createElement("iframe");
      document.body.append(iframe);
      const doc = iframe.contentDocument!;
      doc.body.innerHTML =
        '<div id="card"></div><div id="future" data-hf-clip-hidden style="visibility: hidden"></div>';
      const element = doc.getElementById("card")!;
      const future = doc.getElementById("future")!;
      const outside = document.createElement("div");
      outside.setAttribute("data-hf-clip-hidden", "");
      outside.style.visibility = "hidden";
      document.body.append(outside);
      const reads: boolean[] = [];
      const visibilityReads: string[] = [];
      const outsideReads: boolean[] = [];
      const setReads: boolean[] = [];
      const seek = vi.fn(() => {
        reads.push(future.hasAttribute("data-hf-filter-sampling"));
        visibilityReads.push(future.style.visibility);
        outsideReads.push(outside.hasAttribute("data-hf-filter-sampling"));
        if (throws === "seek") throw new Error("preview seek failed");
      });
      const set = vi.fn((_target: Element, properties: Record<string, unknown>) => {
        if ("clearProps" in properties) return;
        setReads.push(future.hasAttribute("data-hf-filter-sampling"));
        if (throws === "set") throw new Error("preview set failed");
      });
      Reflect.set(iframe.contentWindow!, "gsap", { getProperty: () => 0, set });
      Reflect.set(iframe.contentWindow!, "__timelines", { main: { duration: () => 5, seek } });
      Reflect.set(iframe.contentWindow!, "__player", { getTime: () => 2 });
      usePlayerStore.getState().setCurrentTime(2);
      const commitMutation = vi.fn(async () => {});
      const showToast = vi.fn();
      let hook: ReturnType<typeof useGestureCommit> | undefined;
      function Harness() {
        hook = useGestureCommit({
          domEditSessionRef: {
            current: {
              domEditSelection: {
                ...makeSelection("Card", element),
                dataAttributes: { start: "0", duration: "5" },
              },
              commitMutation,
            },
          },
          previewIframeRef: { current: iframe },
          showToast,
          isGestureRecordingRef: { current: false },
          readOnlyPreview: false,
        });
        return null;
      }
      const root = mountReactHarness(<Harness />);
      try {
        act(() => hook?.handleToggleRecording("keyboard"));
        document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 10 }));
        for (let frame = 0; frame < frames; frame++) {
          nowMs = frame * 34;
          act(() => queue.shift()?.(nowMs));
          expect(future.hasAttribute("data-hf-filter-sampling")).toBe(false);
        }
        await act(async () => hook?.handleToggleRecording("keyboard"));
        expect(hook?.gestureState).toBe("idle");
        expect(showToast).toHaveBeenCalledWith(
          "No gesture detected. Move the pointer while recording",
          "error",
        );
        expect(commitMutation).not.toHaveBeenCalled();
        expect(usePlayerStore.getState().requestedSeekTime).toBe(2);
        expect(future.style.visibility).toBe("hidden");
        expect(future.hasAttribute("data-hf-clip-hidden")).toBe(true);
        expect(reads).toEqual(Array(frames).fill(true));
        expect(visibilityReads).toEqual(Array(frames).fill("hidden"));
        expect(outsideReads).toEqual(Array(frames).fill(false));
        expect(setReads).toEqual(throws === "seek" ? [] : Array(frames).fill(true));
      } finally {
        act(() => root.unmount());
      }
    },
  );
});
