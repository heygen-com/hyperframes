// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioShellProvider } from "../contexts/StudioContext";
import { PanelLayoutProvider } from "../contexts/PanelLayoutContext";
import {
  ViewModeProvider,
  useViewModeState,
  type StudioViewMode,
} from "../contexts/ViewModeContext";
import { usePanelLayout } from "../hooks/usePanelLayout";
import type { RenderJob } from "./renders/useRenderQueue";
import { StudioHeader } from "./StudioHeader";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let host: HTMLDivElement;
let root: Root;

const terminalCases: Array<{ status: "complete" | "failed"; label: string }> = [
  { status: "complete", label: "Render complete" },
  { status: "failed", label: "Render failed" },
];

function renderJob(status: RenderJob["status"]): RenderJob {
  return {
    id: "render-1",
    status,
    progress: status === "rendering" ? 40 : 100,
    filename: "render-1.mp4",
    createdAt: 1,
  };
}

function HeaderHarness({
  jobs,
  startRender,
  storyboardAvailable,
  onViewModeChange,
}: {
  jobs: RenderJob[];
  startRender: (composition?: string) => Promise<void>;
  storyboardAvailable: boolean;
  onViewModeChange: (mode: StudioViewMode) => void;
}) {
  const panelLayout = usePanelLayout({ rightCollapsed: true, rightPanelTab: "design" });
  const viewMode = useViewModeState();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const shellValue = {
    projectId: "project-1",
    activeCompPath: "index.html",
    setActiveCompPath: () => {},
    showToast: () => {},
    previewIframeRef,
    editHistory: {
      canUndo: false,
      canRedo: false,
      undoLabel: undefined,
      redoLabel: undefined,
    },
    handleUndo: async () => {},
    handleRedo: async () => {},
    startRender,
    renderQueue: {
      jobs,
      isRendering: jobs.some((job) => job.status === "rendering"),
      loadError: null,
      actionError: null,
      dismissActionError: () => {},
      reloadRenders: () => {},
      deleteRender: () => {},
      cancelRender: () => {},
      clearCompleted: () => {},
    },
    compositionDimensions: null,
    waitForPendingDomEditSaves: async () => {},
    handlePreviewIframeRef: () => {},
  };

  return (
    <StudioShellProvider value={shellValue}>
      <ViewModeProvider
        value={{
          ...viewMode,
          setViewMode: (mode) => {
            onViewModeChange(mode);
            viewMode.setViewMode(mode);
          },
        }}
      >
        <PanelLayoutProvider value={panelLayout}>
          <StudioHeader
            storyboardAvailable={storyboardAvailable}
            captureFrameHref="#"
            captureFrameFilename="frame.png"
            handleCaptureFrameClick={() => {}}
            refreshCaptureFrameTime={() => {}}
            inspectorButtonActive={false}
            inspectorPanelActive={false}
          />
          <output data-testid="right-panel-tab">{panelLayout.rightPanelTab}</output>
          <output data-testid="view-mode">{viewMode.viewMode}</output>
        </PanelLayoutProvider>
      </ViewModeProvider>
    </StudioShellProvider>
  );
}

function renderHeader(
  jobs: RenderJob[],
  startRender: (composition?: string) => Promise<void>,
  storyboardAvailable = true,
  onViewModeChange: (mode: StudioViewMode) => void = () => {},
): void {
  act(() =>
    root.render(
      <HeaderHarness
        jobs={jobs}
        startRender={startRender}
        storyboardAvailable={storyboardAvailable}
        onViewModeChange={onViewModeChange}
      />,
    ),
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("StudioHeader render status", () => {
  it("starts a master composition render through the shared action", () => {
    const startRender = vi.fn(async () => {});
    renderHeader([], startRender);

    const exportButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Export",
    );
    expect(exportButton).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      if (exportButton instanceof HTMLButtonElement) exportButton.click();
    });

    expect(startRender).toHaveBeenCalledWith(undefined);
  });

  it.each(terminalCases)("shows $label and opens Renders", ({ status, label }) => {
    const startRender = vi.fn(async () => {});
    renderHeader([renderJob("rendering")], startRender);
    expect(host.textContent).toContain("Rendering…");

    renderHeader([renderJob(status)], startRender);
    expect(host.textContent).toContain(label);

    const statusButton = [...host.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === label,
    );
    expect(statusButton).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      if (statusButton instanceof HTMLButtonElement) statusButton.click();
    });

    expect(host.querySelector('[data-testid="right-panel-tab"]')?.textContent).toBe("renders");
    expect(startRender).not.toHaveBeenCalled();
  });
});

describe("StudioHeader storyboard view", () => {
  it("disables storyboard with an accessible reason when no storyboard exists", () => {
    const onViewModeChange = vi.fn();
    renderHeader(
      [],
      vi.fn(async () => {}),
      false,
      onViewModeChange,
    );

    const storyboardTab = [...host.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === "Storyboard",
    );
    expect(storyboardTab).toBeInstanceOf(HTMLButtonElement);
    if (!(storyboardTab instanceof HTMLButtonElement)) return;
    expect(storyboardTab.disabled).toBe(true);
    expect(storyboardTab.getAttribute("aria-label")).toBe(
      "No storyboard yet, add a STORYBOARD.md at the project root to use this view.",
    );

    act(() => {
      storyboardTab.click();
    });

    expect(onViewModeChange).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="view-mode"]')?.textContent).toBe("timeline");
  });

  it("switches to storyboard when storyboard data exists", () => {
    const onViewModeChange = vi.fn();
    renderHeader(
      [],
      vi.fn(async () => {}),
      true,
      onViewModeChange,
    );

    const storyboardTab = [...host.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent?.trim() === "Storyboard",
    );
    expect(storyboardTab).toBeInstanceOf(HTMLButtonElement);
    if (!(storyboardTab instanceof HTMLButtonElement)) return;
    expect(storyboardTab.disabled).toBe(false);

    act(() => {
      storyboardTab.click();
    });

    expect(onViewModeChange).toHaveBeenCalledWith("storyboard");
    expect(host.querySelector('[data-testid="view-mode"]')?.textContent).toBe("storyboard");
  });
});
