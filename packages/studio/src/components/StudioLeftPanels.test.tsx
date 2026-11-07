// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudioLeftPanels } from "./StudioLeftPanels";

const state = vi.hoisted(() => {
  const callbacks: { onRenderComposition?: (path: string) => Promise<void> } = {};
  return {
    callbacks,
    ffmpegMissing: false,
    waitForPendingDomEditSaves: vi.fn<() => Promise<void>>(),
    startRender: vi.fn<(options: { composition: string }) => Promise<void>>(),
    activatePanel: vi.fn(),
  };
});

vi.mock("../contexts/StudioContext", () => ({
  useStudioShellContext: () => ({
    projectId: "demo",
    waitForPendingDomEditSaves: state.waitForPendingDomEditSaves,
    renderQueue: {
      ffmpegMissing: state.ffmpegMissing,
      isRendering: false,
      startRender: state.startRender,
    },
  }),
}));
vi.mock("../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({ compositions: [], assets: [], editingFile: null, fileTree: [] }),
}));
vi.mock("./dock/Dock", () => ({
  Dock: { Panel: ({ children }: { children: ReactNode }) => children },
}));
vi.mock("./dock/dockLayoutStore", () => ({
  useDockLayoutStore: { getState: () => ({ activatePanel: state.activatePanel }) },
}));
vi.mock("./sidebar/CompositionsPanel", () => ({
  CompositionsPanel: ({
    onRenderComposition,
  }: {
    onRenderComposition: (path: string) => Promise<void>;
  }) => {
    state.callbacks.onRenderComposition = onRenderComposition;
    return null;
  },
}));
vi.mock("./editor/SourceEditor", () => ({ SourceEditor: () => null }));
vi.mock("./editor/FileTree", () => ({ FileTree: () => null }));
vi.mock("./MediaPreview", () => ({ MediaPreview: () => null }));
vi.mock("./sidebar/AssetsTab", () => ({ AssetsTab: () => null }));
vi.mock("./sidebar/BlocksTab", () => ({ BlocksTab: () => null }));
vi.mock("./sidebar/SidebarLintButton", () => ({ SidebarLintButton: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | null = null;

beforeEach(() => {
  state.ffmpegMissing = false;
  state.callbacks.onRenderComposition = undefined;
  state.waitForPendingDomEditSaves.mockReset();
  state.startRender.mockReset().mockResolvedValue(undefined);
  state.activatePanel.mockReset();
  localStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  localStorage.clear();
});

function renderPanels() {
  act(() =>
    root?.render(
      <StudioLeftPanels
        onSelectComposition={vi.fn()}
        onAddBlock={vi.fn()}
        onLint={vi.fn()}
        linting={false}
      />,
    ),
  );
}

it("awaits pending saves and forwards only the card composition, or opens Renders when FFmpeg is missing", async () => {
  localStorage.setItem(
    "hf-studio-render-settings",
    JSON.stringify({
      format: "webm",
      quality: "high",
      fps: 60,
      gpu: true,
      rateControl: { mode: "crf", value: 18 },
      videoFrameFormat: "png",
      hdrMode: "force-sdr",
    }),
  );
  let releaseSave: (() => void) | undefined;
  const pendingSave = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  state.waitForPendingDomEditSaves.mockReturnValue(pendingSave);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renderPanels();
  const renderCard = state.callbacks.onRenderComposition;
  if (!renderCard) throw new Error("composition render callback not supplied");
  const rendering = renderCard("parts/card.html");
  expect(state.waitForPendingDomEditSaves).toHaveBeenCalledOnce();
  expect(state.startRender).not.toHaveBeenCalled();
  await act(async () => {
    releaseSave?.();
    await rendering;
  });
  expect(state.startRender).toHaveBeenCalledExactlyOnceWith({ composition: "parts/card.html" });
  expect(state.activatePanel).not.toHaveBeenCalled();

  state.ffmpegMissing = true;
  renderPanels();
  const blockedRender = state.callbacks.onRenderComposition;
  if (!blockedRender) throw new Error("updated render callback not supplied");
  await act(async () => {
    await blockedRender("parts/blocked.html");
  });
  expect(state.activatePanel).toHaveBeenCalledExactlyOnceWith("renders");
  expect(state.waitForPendingDomEditSaves).toHaveBeenCalledOnce();
  expect(state.startRender).toHaveBeenCalledOnce();
});
