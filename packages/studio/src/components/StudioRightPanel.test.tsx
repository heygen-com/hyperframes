// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioRightPanel } from "./StudioRightPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
  inspectorEnabled: true,
  motionEnabled: false,
  rightPanelTabs: ["design", "renders"] as Array<
    "design" | "renders" | "layers" | "css" | "motion"
  >,
}));

vi.mock("./editor/manualEditingAvailability", () => ({
  get STUDIO_INSPECTOR_PANELS_ENABLED() {
    return mockState.inspectorEnabled;
  },
  get STUDIO_MOTION_PANEL_ENABLED() {
    return mockState.motionEnabled;
  },
}));

vi.mock("../contexts/PanelLayoutContext", () => ({
  usePanelLayoutContext: () => ({
    rightWidth: 420,
    rightPanelTabs: mockState.rightPanelTabs,
    rightPanelFocusTab: "design",
    focusRightPanelTab: () => {},
    toggleRightPanelTab: () => {},
    handlePanelResizeStart: () => {},
    handlePanelResizeMove: () => {},
    handlePanelResizeEnd: () => {},
  }),
}));

vi.mock("../contexts/StudioContext", () => ({
  useStudioContext: () => ({
    captionEditMode: false,
    previewIframeRef: { current: null },
    projectId: "demo",
    activeCompPath: null,
    compositionDimensions: { width: 1920, height: 1080 },
    waitForPendingDomEditSaves: async () => {},
    renderQueue: {
      jobs: [],
      deleteRender: () => {},
      clearCompleted: () => {},
      startRender: async () => {},
      isRendering: false,
    },
  }),
}));

vi.mock("../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({
    domEditSelection: null,
    domEditGroupSelections: [],
    copiedAgentPrompt: null,
    clearDomSelection: () => {},
    handleDomStyleCommit: () => {},
    handleDomAttributeCommit: () => {},
    handleDomPathOffsetCommit: () => {},
    handleDomBoxSizeCommit: () => {},
    handleDomRotationCommit: () => {},
    handleDomTextCommit: () => {},
    handleDomTextFieldStyleCommit: () => {},
    handleDomAddTextField: () => {},
    handleDomRemoveTextField: () => {},
    handleAskAgent: () => {},
    handleDomMotionCommit: () => {},
    handleDomMotionClear: () => {},
    applyDomSelection: () => {},
  }),
}));

vi.mock("../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    assets: [],
    fontAssets: [],
    handleImportFiles: () => {},
    handleImportFonts: () => {},
  }),
}));

vi.mock("./editor/PropertyPanel", () => ({
  PropertyPanel: () => React.createElement("div", {}, "PropertyPanel"),
}));
vi.mock("./editor/MotionPanel", () => ({
  MotionPanel: () => React.createElement("div", {}, "MotionPanel"),
}));
vi.mock("./editor/LayersPanel", () => ({
  LayersPanel: () => React.createElement("div", {}, "LayersPanel"),
}));
vi.mock("./editor/LayerCssRulesPanel", () => ({
  LayerCssRulesPanel: () => React.createElement("div", {}, "LayerCssRulesPanel"),
}));
vi.mock("./renders/RenderQueue", () => ({
  RenderQueue: () => React.createElement("div", {}, "RenderQueue"),
}));
vi.mock("../captions/components/CaptionPropertyPanel", () => ({
  CaptionPropertyPanel: () => React.createElement("div", {}, "CaptionPropertyPanel"),
}));

function renderPanel() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(StudioRightPanel, { selectedStudioMotion: null }));
  });
  return {
    host,
    cleanup: () =>
      act(() => {
        root.unmount();
        host.remove();
      }),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  mockState.inspectorEnabled = true;
  mockState.motionEnabled = false;
  mockState.rightPanelTabs = ["design", "renders"];
});

describe("StudioRightPanel", () => {
  it("renders inspector content and renders queue when both tabs are open", () => {
    const { host, cleanup } = renderPanel();
    expect(host.textContent).toContain("PropertyPanel");
    expect(host.textContent).toContain("RenderQueue");
    cleanup();
  });

  it("hides inspector content when inspector panels are disabled", () => {
    mockState.inspectorEnabled = false;
    const { host, cleanup } = renderPanel();
    expect(host.textContent).not.toContain("PropertyPanel");
    expect(host.textContent).toContain("RenderQueue");
    cleanup();
  });
});
