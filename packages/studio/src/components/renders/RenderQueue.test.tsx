// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RenderQueue } from "./RenderQueue";
import type { RenderJob } from "./useRenderQueue";

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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("RenderQueue", () => {
  it("shows a retryable refresh error alongside stale jobs", () => {
    const retry = vi.fn();

    act(() => {
      root.render(
        <RenderQueue
          jobs={[completedJob]}
          projectId="project-1"
          onDelete={() => {}}
          onClearCompleted={() => {}}
          onStartRender={() => {}}
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
