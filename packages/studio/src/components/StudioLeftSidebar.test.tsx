// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startRender } = vi.hoisted(() => ({
  startRender: vi.fn(async () => {}),
}));

vi.mock("../contexts/PanelLayoutContext", () => ({
  usePanelLayoutContext: () => ({
    leftCollapsed: false,
    leftWidth: 240,
    setLeftWidth: vi.fn(),
    toggleLeftSidebar: vi.fn(),
    handlePanelResizeStart: vi.fn(),
    handlePanelResizeMove: vi.fn(),
    handlePanelResizeEnd: vi.fn(),
  }),
}));

vi.mock("../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "project-1",
    startRender,
    renderQueue: { isRendering: false },
    waitForPendingDomEditSaves: vi.fn(async () => {}),
  }),
}));

vi.mock("../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    compositions: ["scenes/intro.html"],
    assets: [],
    editingFile: null,
    fileTree: [],
    revealSourceOffset: null,
    handleFileSelect: vi.fn(),
    handleCreateFile: vi.fn(),
    handleCreateFolder: vi.fn(),
    handleDeleteFile: vi.fn(),
    handleRenameFile: vi.fn(),
    handleDuplicateFile: vi.fn(),
    handleMoveFile: vi.fn(),
    handleImportFiles: vi.fn(),
    handleContentChange: vi.fn(),
  }),
}));

vi.mock("./sidebar/LeftSidebar", () => ({
  LeftSidebar: ({
    onRenderComposition,
  }: {
    onRenderComposition?: (composition: string) => void;
  }) => (
    <button type="button" onClick={() => onRenderComposition?.("scenes/intro.html")}>
      Render composition
    </button>
  ),
}));

vi.mock("./editor/SourceEditor", () => ({ SourceEditor: () => null }));
vi.mock("./MediaPreview", () => ({ MediaPreview: () => null }));

import { StudioLeftSidebar } from "./StudioLeftSidebar";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  startRender.mockClear();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("StudioLeftSidebar", () => {
  it("starts the selected composition through the shared action", () => {
    act(() => {
      root.render(
        <StudioLeftSidebar
          leftSidebarRef={{ current: null }}
          onSelectComposition={() => {}}
          onAddBlock={() => {}}
          onLint={() => {}}
          linting={false}
        />,
      );
    });

    const button = host.querySelector("button");
    expect(button).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      if (button instanceof HTMLButtonElement) button.click();
    });

    expect(startRender).toHaveBeenCalledWith("scenes/intro.html", {
      format: "mp4",
      quality: "standard",
      fps: 30,
    });
  });
});
