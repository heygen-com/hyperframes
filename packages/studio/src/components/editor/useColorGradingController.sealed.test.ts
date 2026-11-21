// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHfColorGrading } from "@hyperframes/core/color-grading";
import { installReactActEnvironment } from "../../hooks/domSelectionTestHarness";
import type { DomEditSelection } from "./domEditing";
import { useColorGradingController } from "./useColorGradingController";
import { sealedPreviewFrame } from "../../player/lib/sealedPreviewFrame.test-helpers";

installReactActEnvironment();

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  delete (window as { __hf?: unknown }).__hf;
  document.body.innerHTML = "";
});

/** The frame's colour grading runtime, on the window the agent serves. */
function installFrameGrading() {
  const stopPlayback = vi.fn();
  const grading = {
    getStatus: vi.fn(() => ({ state: "active", message: "Shader active" })),
    renderPreviews: vi.fn(async (_target: unknown, candidates: Array<{ id: string }>) => ({
      width: 160,
      height: 90,
      images: candidates.map(({ id }) => ({
        id,
        dataUrl: id === "neutral" ? "https://example.com/x.png" : `data:image/png;base64,${id}`,
      })),
    })),
    startPreviewPlayback: vi.fn(() => stopPlayback),
  };
  Object.assign(window, { __hf: { colorGrading: grading } });
  return { grading, stopPlayback };
}

const element = {
  element: document.createElement("video"),
  id: "s1-bg",
  hfId: "hf-bg",
  selector: "#s1-bg",
  selectorIndex: 0,
  tagName: "video",
  sourceFile: "index.html",
  dataAttributes: {},
} as unknown as DomEditSelection;
const target = { id: "s1-bg", hfId: "hf-bg", selector: "#s1-bg", selectorIndex: 0 };

function renderController(iframe: HTMLIFrameElement) {
  let latest: ReturnType<typeof useColorGradingController> | undefined;
  const previewIframeRef = { current: iframe };
  const onSetAttributeLive = vi.fn();
  function Host() {
    latest = useColorGradingController({
      projectId: "proj",
      element,
      previewIframeRef,
      onSetAttributeLive,
    });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(React.createElement(Host)));
  closers.unshift(() => act(() => root.unmount()));
  return () => {
    if (!latest) throw new Error("hook did not render");
    return latest;
  };
}

// Each poll flushes React's queued updates first; a check inside one act would never see them.
const settle = (check: () => void) =>
  vi.waitFor(
    async () => {
      await act(async () => {});
      check();
    },
    { timeout: 3_000 },
  );

describe("grade preview sealed", () => {
  it("reads the frame's grading status over the editing port", async () => {
    const { grading } = installFrameGrading();
    const state = renderController(sealedPreviewFrame().iframe);

    await settle(() =>
      expect(state().runtimeStatus).toEqual({ state: "active", message: "Shader active" }),
    );
    expect(grading.getStatus).toHaveBeenCalledWith(target);
  });

  it("draws preset cards the frame renders, and drops any that are not image data", async () => {
    const { grading } = installFrameGrading();
    const state = renderController(sealedPreviewFrame().iframe);

    act(() => state().requestPresetPreviews());
    await settle(() => expect(state().presetPreviews.images["bright-pop"]).toBeDefined());

    const [renderedFor, candidates, options] = grading.renderPreviews.mock.calls[0]!;
    expect(renderedFor).toEqual(target);
    expect(candidates).toHaveLength(18);
    expect(options).toMatchObject({ maxDimension: 160 });
    expect(state().presetPreviews).toMatchObject({ width: 160, height: 90 });
    expect(state().presetPreviews.images["bright-pop"]).toBe("data:image/png;base64,bright-pop");
    expect(state().presetPreviews.images.neutral).toBeUndefined();
  });

  it("plays the hovered card in the frame and stops it when the hover ends", async () => {
    const { grading, stopPlayback } = installFrameGrading();
    const state = renderController(sealedPreviewFrame().iframe);
    const look = normalizeHfColorGrading({ preset: "bright-pop", intensity: 1 })!;

    act(() =>
      state().previewColorGrading(look, { animatedPreview: { kind: "presets", id: "bright-pop" } }),
    );
    await settle(() => expect(grading.renderPreviews).toHaveBeenCalled());
    expect(grading.startPreviewPlayback).toHaveBeenCalledWith(target);
    expect(grading.renderPreviews.mock.calls[0]![2]).toEqual({
      maxDimension: 160,
      useMediaTime: true,
    });
    await settle(() =>
      expect(state().presetPreviews.images["bright-pop"]).toBe("data:image/png;base64,bright-pop"),
    );

    act(() => state().previewColorGrading(null));
    await settle(() => expect(stopPlayback).toHaveBeenCalledTimes(1));
  });

  it("captures a graded frame from the frame", async () => {
    installFrameGrading();
    const state = renderController(sealedPreviewFrame().iframe);

    const frame = await act(() => state().captureGradedFrame());
    expect(frame).toEqual({ dataUrl: "data:image/png;base64,capture", width: 160, height: 90 });
  });
});
