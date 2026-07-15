// @vitest-environment happy-dom
//
// Task 13b regression test: before this fix, `StudioRightPanel` never passed
// a `vstHost` prop to `PropertyPanel` at all (it defaulted to `null` there),
// so the FX panel always rendered its "not available" install-hint state.
// This test proves the panel now forwards the ONE shared `useVstHost()`
// instance (threaded through `NLEContext`) rather than either omitting it or
// creating a second, independent connection of its own.
//
// Every context `StudioRightPanel` reads is mocked to the minimal shape it
// actually destructures (mirroring PropertyPanel.test.tsx's established
// pattern for this codebase), and the real `PropertyPanel` + heavier tab
// panels are replaced with lightweight stand-ins so this test exercises only
// the prop-forwarding wiring, not their internals.

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VstHostApi } from "./editor/propertyPanelVstSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let capturedVstHost: VstHostApi | null | undefined;

vi.mock("./editor/PropertyPanel", () => ({
  PropertyPanel: (props: { vstHost?: VstHostApi | null }) => {
    capturedVstHost = props.vstHost;
    return null;
  },
}));

vi.mock("./DesignPanelPromoteProvider", () => ({
  DesignPanelPromoteProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../contexts/StudioContext", async () => {
  const actual = await vi.importActual<typeof import("../contexts/StudioContext")>(
    "../contexts/StudioContext",
  );
  return {
    ...actual,
    useStudioShellContext: () => ({
      previewIframeRef: { current: null },
      projectId: "proj-1",
      activeCompPath: "index.html",
      showToast: vi.fn(),
      compositionDimensions: null,
      waitForPendingDomEditSaves: async () => {},
      renderQueue: {
        jobs: [],
        isRendering: false,
        loadError: null,
        actionError: null,
        dismissActionError: () => {},
        reloadRenders: () => {},
        deleteRender: () => {},
        cancelRender: () => {},
        clearCompleted: () => {},
        startRender: async () => {},
      },
    }),
    useStudioPlaybackContext: () => ({ captionEditMode: false, refreshKey: 0 }),
  };
});

vi.mock("../contexts/PanelLayoutContext", async () => {
  const actual = await vi.importActual<typeof import("../contexts/PanelLayoutContext")>(
    "../contexts/PanelLayoutContext",
  );
  return {
    ...actual,
    usePanelLayoutContext: () => ({
      rightWidth: 320,
      setRightWidth: () => {},
      rightPanelTab: "design",
      setRightPanelTab: () => {},
      rightInspectorPanes: { design: true, layers: false },
      toggleRightInspectorPane: () => {},
      handlePanelResizeStart: () => {},
      handlePanelResizeMove: () => {},
      handlePanelResizeEnd: () => {},
    }),
  };
});

vi.mock("../contexts/FileManagerContext", async () => {
  const actual = await vi.importActual<typeof import("../contexts/FileManagerContext")>(
    "../contexts/FileManagerContext",
  );
  return {
    ...actual,
    useFileManagerContext: () => ({
      assets: [],
      fontAssets: [],
      projectDir: "",
      handleImportFiles: async () => {},
      handleImportFonts: async () => {},
      refreshFileTree: async () => {},
      readProjectFile: async () => "",
      writeProjectFile: async () => {},
      fileTree: [],
    }),
  };
});

vi.mock("../contexts/DomEditContext", async () => {
  const actual = await vi.importActual<typeof import("../contexts/DomEditContext")>(
    "../contexts/DomEditContext",
  );
  return {
    ...actual,
    useDomEditContext: () => ({
      domEditSelection: null,
      domEditGroupSelections: [],
      copiedAgentPrompt: null,
      clearDomSelection: () => {},
      handleUngroupSelection: () => {},
      handleGroupSelection: () => {},
      handleDomStyleCommit: () => {},
      handleDomAttributeCommit: async () => {},
      handleDomAttributeLiveCommit: () => {},
      handleDomHtmlAttributeCommit: async () => {},
      handleDomAttributesCommit: async () => {},
      handleDomPathOffsetCommit: () => {},
      handleDomBoxSizeCommit: () => {},
      handleDomRotationCommit: () => {},
      handleDomTextCommit: () => {},
      handleDomTextFieldStyleCommit: () => {},
      handleDomAddTextField: () => {},
      handleDomRemoveTextField: () => {},
      handleAskAgent: () => {},
      selectedGsapAnimations: [],
      gsapMultipleTimelines: false,
      gsapUnsupportedTimelinePattern: null,
      handleGsapUpdateProperty: () => {},
      handleGsapUpdateMeta: () => {},
      handleGsapDeleteAnimation: () => {},
      handleGsapAddAnimation: () => {},
      handleGsapAddProperty: () => {},
      handleGsapRemoveProperty: () => {},
      handleGsapUpdateFromProperty: () => {},
      handleGsapAddFromProperty: () => {},
      handleGsapRemoveFromProperty: () => {},
      commitAnimatedProperty: () => {},
      commitAnimatedProperties: () => {},
      handleSetArcPath: () => {},
      handleUpdateArcSegment: () => {},
      handleUnroll: () => {},
      handleUpdateKeyframeEase: () => {},
      handleSetAllKeyframeEases: () => {},
      handleGsapAddKeyframe: () => {},
      handleGsapRemoveKeyframe: () => {},
      handleGsapConvertToKeyframes: () => {},
    }),
  };
});

const fakeVstHost = {
  api: {
    registry: [],
    scan: async () => {},
    openEditor: () => {},
    loadChain: async () => 0,
    getState: async () => [],
  } satisfies VstHostApi,
  status: "ready" as const,
  installHint: null,
  ensureStarted: async () => {},
  onPcmFrame: () => () => {},
  sendTransport: () => {},
  onDisconnect: () => () => {},
  onChainLoaded: () => () => {},
};

// StudioRightPanel only imports `useNLEContext` from this module — no need to
// load the real NLEProvider (and its useTimelinePlayer/useVstHost chain) for
// this test.
vi.mock("./nle/NLEContext", () => ({
  useNLEContext: () => ({ vstHost: fakeVstHost }),
}));

afterEach(() => {
  document.body.innerHTML = "";
  capturedVstHost = undefined;
  vi.resetModules();
});

describe("StudioRightPanel — vstHost wiring", () => {
  // The dynamic import below pulls in StudioRightPanel's full (heavy) module
  // graph the first time this file runs; under a full-suite run alongside
  // hundreds of other test files that can exceed vitest's default 5s.
  it("forwards the shared vstHost.api (not null) into PropertyPanel", async () => {
    const { StudioRightPanel } = await import("./StudioRightPanel");

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        React.createElement(StudioRightPanel, {
          designPanelActive: true,
          sdkSession: null,
          reloadPreview: () => {},
          domEditSaveTimestampRef: { current: 0 },
          recordEdit: async () => {},
        }),
      );
      await Promise.resolve();
    });

    expect(capturedVstHost).toBe(fakeVstHost.api);
    expect(capturedVstHost).not.toBeNull();

    act(() => root.unmount());
    host.remove();
  }, 15000);
});
