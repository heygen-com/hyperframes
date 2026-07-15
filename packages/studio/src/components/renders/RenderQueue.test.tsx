// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderQueue } from "./RenderQueue";
import type { RenderJob } from "./useRenderQueue";

const { startRender } = vi.hoisted(() => ({ startRender: vi.fn(async () => {}) }));

vi.mock("../../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    activeCompPath: "scenes/intro.html",
    startRender,
  }),
}));

vi.mock("../../hooks/previewVariablesStore", () => ({
  usePreviewVariablesStore: { getState: () => ({ values: { headline: "Hello" } }) },
}));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let host: HTMLDivElement;
let root: Root;

const completedJob: RenderJob = {
  id: "render-1",
  status: "complete",
  progress: 100,
  filename: "finished.mp4",
  createdAt: 1,
};

beforeEach(() => {
  startRender.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("RenderQueue", () => {
  it("starts the active composition through the shared action", () => {
    act(() => {
      root.render(
        <RenderQueue
          jobs={[]}
          projectId="project-1"
          onDelete={() => {}}
          onClearCompleted={() => {}}
          isRendering={false}
        />,
      );
    });

    const exportButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Export",
    );
    expect(exportButton).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      if (exportButton instanceof HTMLButtonElement) exportButton.click();
    });

    expect(startRender).toHaveBeenCalledWith("scenes/intro.html", {
      format: "mp4",
      quality: "standard",
      resolution: "auto",
      fps: 30,
      variables: { headline: "Hello" },
    });
  });

  it("shows a retryable refresh error alongside stale jobs", () => {
    const retry = vi.fn();

    act(() => {
      root.render(
        <RenderQueue
          jobs={[completedJob]}
          projectId="project-1"
          onDelete={() => {}}
          onClearCompleted={() => {}}
          isRendering={false}
          loadError="Could not refresh render history."
          onRetryLoad={retry}
        />,
      );
    });

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Could not refresh render history.");
    expect(host.textContent).toContain("finished.mp4");

    const retryButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retryButton).toBeInstanceOf(HTMLButtonElement);
    if (retryButton instanceof HTMLButtonElement) retryButton.click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
