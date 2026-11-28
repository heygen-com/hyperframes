// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StartRenderHandler } from "./RenderQueue";
import { RenderQueuePanel } from "./RenderQueuePanel";

const mocks = vi.hoisted(() => ({
  startRender: vi.fn(async () => {}),
  wait: vi.fn(async () => {}),
}));
let exportCallback: StartRenderHandler | undefined;
vi.mock("./RenderQueue", () => ({
  RenderQueue: ({ onStartRender }: { onStartRender: StartRenderHandler }) => {
    exportCallback = onStartRender;
    return null;
  },
}));
vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "demo",
    compositionDimensions: null,
    waitForPendingDomEditSaves: mocks.wait,
    renderQueue: { jobs: [], startRender: mocks.startRender },
  }),
}));
vi.mock("../../hooks/previewVariablesStore", () => ({
  usePreviewVariablesStore: { getState: () => ({ values: { title: "Preview" } }) },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;
beforeEach(() => {
  mocks.startRender.mockClear();
  mocks.wait.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  exportCallback = undefined;
});

function callback(): StartRenderHandler {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<RenderQueuePanel />));
  if (!exportCallback) throw new Error("Panel did not provide its export callback");
  return exportCallback;
}

describe("render panel settings bridge", () => {
  it("waits for saves and forwards advanced settings with preview variables", async () => {
    let finishSave = () => {};
    mocks.wait.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const advanced = {
      rateControl: { mode: "crf" as const, value: 0 },
      videoFrameFormat: "png" as const,
      hdrMode: "force-sdr" as const,
    };
    const pending = callback()("mp4", "high", "auto", 60, false, undefined, advanced);
    expect(mocks.startRender).not.toHaveBeenCalled();
    finishSave();
    await pending;
    expect(mocks.startRender).toHaveBeenCalledExactlyOnceWith({
      format: "mp4",
      quality: "high",
      resolution: "auto",
      fps: 60,
      gpu: false,
      ...advanced,
      variables: { title: "Preview" },
    });
  });

  it("makes the legacy five-argument Auto intent explicit", async () => {
    await callback()("mp4", "standard", "auto", 30, false);
    expect(mocks.startRender).toHaveBeenCalledExactlyOnceWith({
      format: "mp4",
      quality: "standard",
      resolution: "auto",
      fps: 30,
      gpu: false,
      rateControl: { mode: "auto" },
      videoFrameFormat: "auto",
      hdrMode: "auto",
      variables: { title: "Preview" },
    });
  });
});

describe("GIF panel settings bridge", () => {
  it("forwards a numeric loop count with preview variables and Auto encoder settings", async () => {
    await callback()("gif", "standard", "auto", 30, false, 3);
    expect(mocks.wait).toHaveBeenCalledOnce();
    expect(mocks.startRender).toHaveBeenCalledExactlyOnceWith({
      format: "gif",
      quality: "standard",
      resolution: "auto",
      fps: 30,
      gpu: false,
      gifLoop: 3,
      rateControl: { mode: "auto" },
      videoFrameFormat: "auto",
      hdrMode: "auto",
      variables: { title: "Preview" },
    });
  });

  it("does not forward video advanced settings when exporting GIF", async () => {
    await callback()("gif", "standard", "auto", 30, false, undefined, {
      rateControl: { mode: "crf", value: 18 },
      videoFrameFormat: "png",
      hdrMode: "force-hdr",
    });
    expect(mocks.startRender).toHaveBeenCalledExactlyOnceWith({
      format: "gif",
      quality: "standard",
      resolution: "auto",
      fps: 30,
      gpu: false,
      rateControl: { mode: "auto" },
      videoFrameFormat: "auto",
      hdrMode: "auto",
      variables: { title: "Preview" },
    });
  });
});
