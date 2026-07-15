// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const panelLayout = {
  rightWidth: 160,
  setRightWidth: vi.fn(),
  rightPanelTab: "renders",
  setRightPanelTab: vi.fn(),
  rightInspectorPanes: { design: true, layers: true },
  toggleRightInspectorPane: vi.fn(),
  handlePanelResizeStart: vi.fn(),
  handlePanelResizeMove: vi.fn(),
  handlePanelResizeEnd: vi.fn(),
};

vi.mock("../contexts/PanelLayoutContext", () => ({
  usePanelLayoutContext: () => panelLayout,
}));
vi.mock("../contexts/StudioContext", () => ({
  useStudioPlaybackContext: () => ({ captionEditMode: false, refreshKey: 0 }),
  useStudioShellContext: () => ({
    previewIframeRef: { current: null },
    projectId: "project-1",
    activeCompPath: "index.html",
    showToast: vi.fn(),
    compositionDimensions: { width: 1920, height: 1080 },
    waitForPendingDomEditSaves: vi.fn(async () => {}),
    renderQueue: {
      jobs: [],
      deleteRender: vi.fn(),
      cancelRender: vi.fn(),
      reloadRenders: vi.fn(),
      dismissActionError: vi.fn(),
      clearCompleted: vi.fn(),
      isRendering: false,
    },
  }),
}));
vi.mock("../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    assets: [],
    fontAssets: [],
    projectDir: "",
    handleImportFiles: vi.fn(),
    handleImportFonts: vi.fn(),
    refreshFileTree: vi.fn(),
    readProjectFile: vi.fn(),
    writeProjectFile: vi.fn(),
    fileTree: [],
  }),
}));
vi.mock("../contexts/DomEditContext", () => ({
  useDomEditContext: () => ({ domEditSelection: null, domEditGroupSelections: [] }),
}));
vi.mock("../hooks/useSlideshowPersist", () => ({ useSlideshowPersist: () => vi.fn() }));
vi.mock("../hooks/previewVariablesStore", () => ({
  usePreviewVariablesStore: { getState: () => ({ values: undefined }) },
}));
vi.mock("../player", () => ({ usePlayerStore: { getState: () => ({ requestSeek: vi.fn() }) } }));
vi.mock("./editor/PropertyPanel", () => ({ PropertyPanel: () => <div /> }));
vi.mock("./editor/LayersPanel", () => ({ LayersPanel: () => <div /> }));
vi.mock("../captions/components/CaptionPropertyPanel", () => ({
  CaptionPropertyPanel: () => <div />,
}));
vi.mock("./renders/RenderQueue", () => ({ RenderQueue: () => <div>Render queue</div> }));
vi.mock("./panels/SlideshowPanel", () => ({ SlideshowPanel: () => <div /> }));
vi.mock("./panels/VariablesPanel", () => ({ VariablesPanel: () => <div /> }));
vi.mock("./DesignPanelPromoteProvider", () => ({
  DesignPanelPromoteProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./studioMediaJobs", () => ({ waitForMediaJob: vi.fn() }));
vi.mock("./studioColorGradingScope", () => ({
  applyColorGradingScopeUpdate: vi.fn(),
  EMPTY_COLOR_GRADING_SCOPE_RESULT: {},
}));

import { StudioRightPanel } from "./StudioRightPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function renderPanel() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <StudioRightPanel
        designPanelActive
        sdkSession={null}
        reloadPreview={() => {}}
        domEditSaveTimestampRef={{ current: 0 }}
        recordEdit={async () => {}}
      />,
    );
  });
  return { host, root };
}

afterEach(() => {
  panelLayout.rightPanelTab = "renders";
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("StudioRightPanel layout", () => {
  it("keeps every tab reachable at the minimum panel width", () => {
    const { host, root } = renderPanel();
    const labels = ["Design", "Layers", "Renders", "Slideshow", "Variables"];
    const buttons = labels.map((label) => {
      const button = Array.from(host.querySelectorAll("button")).find(
        (candidate) => candidate.textContent === label,
      );
      if (!button) throw new Error(`missing ${label} tab`);
      return button;
    });
    const tabStrip = buttons[0]?.parentElement?.parentElement;
    if (!tabStrip) throw new Error("tab strip did not render");

    expect(tabStrip.classList.contains("overflow-x-auto")).toBe(true);
    expect(buttons.every((button) => button.classList.contains("flex-shrink-0"))).toBe(true);

    act(() => root.unmount());
  });

  it("restores the inspector split from preferences", () => {
    panelLayout.rightPanelTab = "design";
    localStorage.setItem("hf-studio-ui-preferences", JSON.stringify({ inspectorSplitPercent: 55 }));
    const { host, root } = renderPanel();
    const separator = host.querySelector('[aria-label="Resize Layers and Design panes"]');
    const layersPane = separator?.previousElementSibling;
    if (!(layersPane instanceof HTMLElement)) throw new Error("layers pane did not render");

    expect(layersPane.style.flexBasis).toBe("55%");

    act(() => root.unmount());
  });

  it("persists inspector split changes", () => {
    panelLayout.rightPanelTab = "design";
    const { host, root } = renderPanel();
    const separator = host.querySelector('[aria-label="Resize Layers and Design panes"]');
    const container = separator?.parentElement;
    if (!(separator instanceof HTMLElement) || !container) {
      throw new Error("inspector split did not render");
    }
    const originalRect = container.getBoundingClientRect();
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      ...originalRect,
      bottom: originalRect.top + 200,
      height: 200,
    });

    act(() => {
      separator.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientY: 0, pointerId: 1 }),
      );
      separator.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientY: 40, pointerId: 1 }),
      );
    });

    const stored = JSON.parse(localStorage.getItem("hf-studio-ui-preferences") ?? "{}");
    expect(stored).toMatchObject({ inspectorSplitPercent: 60 });

    act(() => root.unmount());
  });
});
