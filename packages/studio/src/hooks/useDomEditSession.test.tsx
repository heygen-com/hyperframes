// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { shouldUseSdkCutover } from "../utils/sdkCutover";
import type { PatchOperation } from "../utils/sourcePatcher";
import type { Composition } from "@hyperframes/sdk";
import type { UseDomEditSessionParams } from "./useDomEditSession";

const styleOp = (property: string, value: string): PatchOperation => ({
  type: "inline-style",
  property,
  value,
});

const attrOp = (property: string, value: string): PatchOperation => ({
  type: "attribute",
  property,
  value,
});

describe("shouldUseSdkCutover", () => {
  it("returns false when flag is disabled", () => {
    expect(shouldUseSdkCutover(false, true, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when no SDK session", () => {
    expect(shouldUseSdkCutover(true, false, "hf-abc", [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when selection has no hfId", () => {
    expect(shouldUseSdkCutover(true, true, null, [styleOp("color", "red")])).toBe(false);
    expect(shouldUseSdkCutover(true, true, undefined, [styleOp("color", "red")])).toBe(false);
  });

  it("returns false when ops array is empty", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [])).toBe(false);
  });

  it("returns true when all conditions met with supported op types", () => {
    expect(shouldUseSdkCutover(true, true, "hf-abc", [styleOp("color", "red")])).toBe(true);
    expect(
      shouldUseSdkCutover(true, true, "hf-abc", [styleOp("color", "red"), attrOp("data-x", "1")]),
    ).toBe(true);
  });
});

// ── onReorderShadow source filter (Fix 3) ────────────────────────────────────
//
// useDomEditSession composes ~9 sub-hooks; the only one relevant to this fix is
// useDomEditCommits, which receives the onReorderShadow callback built inline.
// Every other sub-hook is stubbed to a minimal shape so the hook under test can
// render without pulling in unrelated preview/GSAP/selection machinery.

const recordResolverParity = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const capturedOnReorderShadow: { fn: ((targets: string[]) => void) | undefined } = {
  fn: undefined,
};

vi.mock("../utils/sdkResolverShadow", () => ({
  runResolverShadow: vi.fn(),
  recordResolverParity: (...args: unknown[]) => recordResolverParity(...args),
}));
vi.mock("./useDomEditCommits", () => ({
  useDomEditCommits: (params: { onReorderShadow?: (targets: string[]) => void }) => {
    capturedOnReorderShadow.fn = params.onReorderShadow;
    return {
      resolveImportedFontAsset: vi.fn(),
      handleDomStyleCommit: vi.fn(),
      handleDomAttributeCommit: vi.fn(),
      handleDomAttributeLiveCommit: vi.fn(),
      handleDomHtmlAttributeCommit: vi.fn(),
      handleDomTextCommit: vi.fn(),
      handleDomTextFieldStyleCommit: vi.fn(),
      handleDomAddTextField: vi.fn(),
      handleDomRemoveTextField: vi.fn(),
      handleDomBoxSizeCommit: vi.fn(),
      handleDomManualEditsReset: vi.fn(),
      handleDomEditElementDelete: vi.fn(),
      handleDomZIndexReorderCommit: vi.fn(),
    };
  },
}));
vi.mock("./useDomSelection", () => ({
  useDomSelection: () => ({
    domEditSelection: null,
    domEditGroupSelections: [],
    domEditHoverSelection: null,
    activeGroupElement: null,
    domEditSelectionRef: { current: null },
    domEditGroupSelectionsRef: { current: [] },
    setActiveGroupElement: vi.fn(),
    applyDomSelection: vi.fn(),
    clearDomSelection: vi.fn(),
    buildDomSelectionFromTarget: vi.fn(),
    resolveDomSelectionFromPreviewPoint: vi.fn(),
    resolveAllDomSelectionsFromPreviewPoint: vi.fn(),
    updateDomEditHoverSelection: vi.fn(),
    buildDomSelectionForTimelineElement: vi.fn(),
    handleTimelineElementSelect: vi.fn(),
    refreshDomEditSelectionFromPreview: vi.fn(),
    applyMarqueeSelection: vi.fn(),
  }),
}));
vi.mock("./useAskAgentModal", () => ({
  useAskAgentModal: () => ({
    agentModalOpen: false,
    agentModalAnchorPoint: null,
    copiedAgentPrompt: null,
    agentPromptSelectionContext: null,
    setAgentModalOpen: vi.fn(),
    setAgentPromptSelectionContext: vi.fn(),
    setAgentModalAnchorPoint: vi.fn(),
    handleAskAgent: vi.fn(),
    handleAgentModalSubmit: vi.fn(),
  }),
}));
vi.mock("./useStudioSelectionPublisher", () => ({
  useStudioSelectionPublisher: () => {},
}));
vi.mock("./useGsapTweenCache", () => ({
  useGsapCacheVersion: () => ({ version: 0, bump: vi.fn() }),
}));
vi.mock("./useGsapScriptCommits", () => ({
  useGsapScriptCommits: () => ({
    commitMutation: vi.fn(),
    updateGsapProperty: vi.fn(),
    updateGsapMeta: vi.fn(),
    deleteGsapAnimation: vi.fn(),
    deleteAllForSelector: vi.fn(),
    addGsapAnimation: vi.fn(),
    addGsapProperty: vi.fn(),
    removeGsapProperty: vi.fn(),
    updateGsapFromProperty: vi.fn(),
    addGsapFromProperty: vi.fn(),
    removeGsapFromProperty: vi.fn(),
    addKeyframe: vi.fn(),
    addKeyframeBatch: vi.fn(),
    removeKeyframe: vi.fn(),
    moveKeyframe: vi.fn(),
    resizeKeyframedTween: vi.fn(),
    convertToKeyframes: vi.fn(),
    removeAllKeyframes: vi.fn(),
    setArcPath: vi.fn(),
    updateArcSegment: vi.fn(),
  }),
}));
vi.mock("./useGroupCommits", () => ({
  useGroupCommits: () => ({
    groupSelection: vi.fn(),
    ungroupSelection: vi.fn(),
  }),
}));
vi.mock("./useDomEditWiring", () => ({
  useDomEditWiring: () => ({
    onClickToSource: vi.fn(),
    selectedGsapAnimations: [],
    gsapMultipleTimelines: false,
    gsapUnsupportedTimelinePattern: false,
    trackGsapInteractionFailure: vi.fn(),
    makeFetchFallback: vi.fn(),
    handleGsapUpdateProperty: vi.fn(),
    handleGsapUpdateMeta: vi.fn(),
    handleGsapDeleteAnimation: vi.fn(),
    handleGsapDeleteAllForElement: vi.fn(),
    handleGsapAddAnimation: vi.fn(),
    handleGsapAddProperty: vi.fn(),
    handleGsapRemoveProperty: vi.fn(),
    handleGsapUpdateFromProperty: vi.fn(),
    handleGsapAddFromProperty: vi.fn(),
    handleGsapRemoveFromProperty: vi.fn(),
    handleGsapAddKeyframe: vi.fn(),
    handleGsapAddKeyframeBatch: vi.fn(),
    handleGsapRemoveKeyframe: vi.fn(),
    handleGsapMoveKeyframeToPlayhead: vi.fn(),
    handleGsapMoveKeyframe: vi.fn(),
    handleGsapResizeKeyframedTween: vi.fn(),
    handleGsapConvertToKeyframes: vi.fn(),
    handleGsapRemoveAllKeyframes: vi.fn(),
    handleResetSelectedElementKeyframes: vi.fn(),
  }),
}));
vi.mock("./usePreviewInteraction", () => ({
  usePreviewInteraction: () => ({
    handlePreviewCanvasMouseDown: vi.fn(),
    handlePreviewCanvasPointerMove: vi.fn(),
    handlePreviewCanvasPointerLeave: vi.fn(),
    handleBlockedDomMove: vi.fn(),
    handleDomManualDragStart: vi.fn(),
  }),
}));
vi.mock("./useGsapAwareEditing", () => ({
  useGsapAwareEditing: () => ({
    handleGsapAwarePathOffsetCommit: vi.fn(),
    handleGsapAwareGroupPathOffsetCommit: vi.fn(),
    handleGsapAwareBoxSizeCommit: vi.fn(),
    handleGsapAwareRotationCommit: vi.fn(),
    commitAnimatedProperty: vi.fn(),
    commitAnimatedProperties: vi.fn(),
    handleSetArcPath: vi.fn(),
    handleUpdateArcSegment: vi.fn(),
    handleUnroll: vi.fn(),
    commitMutation: vi.fn(),
  }),
}));

// Tell React this is an act-capable environment so act(...) flushes effects.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("onReorderShadow source filter", () => {
  it("passes a readSource function as the 4th recordResolverParity argument when sdkSession and activeCompPath are set", async () => {
    const { useDomEditSession } = await import("./useDomEditSession");
    const readProjectFile = vi.fn(async (path: string) => `content of ${path}`);
    // Minimal opaque test double: no sub-hook under test actually calls into the
    // session (useDomEditCommits and recordResolverParity are both mocked above),
    // so it only needs to flow through as a reference.
    const sdkSession = {} as unknown as Composition;

    function Probe() {
      const params: UseDomEditSessionParams = {
        projectId: "proj-1",
        activeCompPath: "index.html",
        isMasterView: false,
        compIdToSrc: new Map(),
        captionEditMode: false,
        compositionLoading: false,
        previewIframeRef: { current: null },
        timelineElements: [],
        setSelectedTimelineElementId: vi.fn(),
        setRightCollapsed: vi.fn(),
        setRightPanelTab: vi.fn(),
        showToast: vi.fn(),
        refreshPreviewDocumentVersion: vi.fn(),
        queueDomEditSave: vi.fn(async (save: () => Promise<void>) => save()),
        readProjectFile,
        writeProjectFile: vi.fn(async () => {}),
        updateEditingFileContent: vi.fn(),
        domEditSaveTimestampRef: { current: 0 },
        editHistory: { recordEdit: vi.fn(async () => {}) },
        fileTree: [],
        importedFontAssetsRef: { current: [] },
        projectDir: null,
        projectIdRef: { current: "proj-1" },
        previewIframe: null,
        refreshKey: 0,
        previewDocumentVersion: 0,
        rightPanelTab: "design",
        applyStudioManualEditsToPreviewRef: { current: async () => {} },
        syncPreviewHistoryHotkey: vi.fn(),
        reloadPreview: vi.fn(),
        setRefreshKey: vi.fn(),
        sdkSession,
        forceReloadSdkSession: vi.fn(),
      };
      useDomEditSession(params);
      return null;
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => {
      root.render(<Probe />);
    });
    try {
      expect(capturedOnReorderShadow.fn).toBeTypeOf("function");
      capturedOnReorderShadow.fn?.(["hf-target"]);
      expect(recordResolverParity).toHaveBeenCalledWith(
        sdkSession,
        "hf-target",
        "reorderElements",
        expect.any(Function),
      );
    } finally {
      act(() => root.unmount());
    }
  });
});
