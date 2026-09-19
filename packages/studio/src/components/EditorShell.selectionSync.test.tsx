// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorShell } from "./EditorShell";
import { isPreviewReadOnly } from "./editor/previewReadOnlyStore";

const hookMocks = vi.hoisted(() => ({
  useTimelineSelectionPreviewSync: vi.fn(),
}));

vi.mock("../hooks/useTimelineSelectionPreviewSync", () => hookMocks);
vi.mock("../contexts/StudioContext", () => ({
  useStudioPlaybackContext: () => ({
    captionEditMode: false,
    refreshKey: 0,
    refreshPreviewDocumentVersion: vi.fn(),
    timelineElements: [],
  }),
  useStudioShellContext: () => ({
    projectId: "project-1",
    activeCompPath: "index.html",
    setActiveCompPath: vi.fn(),
    handlePreviewIframeRef: vi.fn(),
    showToast: vi.fn(),
  }),
}));
vi.mock("../contexts/DomEditContext", () => ({
  useDomEditActionsContext: () => ({
    handleTimelineElementSelect: vi.fn(),
    buildDomSelectionForTimelineElement: vi.fn(),
    applyDomSelection: vi.fn(),
    applyMarqueeSelection: vi.fn(),
  }),
  useDomEditSelectionContext: () => ({
    domEditSelection: null,
    domEditGroupSelections: [],
  }),
}));
vi.mock("./nle/NLEContext", () => ({
  NLEProvider: ({ children }: { children: React.ReactNode }) => children,
  useNLEContext: () => ({
    compositionStack: [],
    updateCompositionStack: vi.fn(),
  }),
}));
vi.mock("./nle/useTimelineEditCallbacks", () => ({
  useTimelineEditCallbacks: () => ({}),
}));
vi.mock("./nle/PreviewPane", () => ({ PreviewPane: () => null }));
vi.mock("./nle/PreviewOverlays", () => ({ PreviewOverlays: () => null }));
vi.mock("./nle/TimelinePane", () => ({ TimelinePane: () => null }));
vi.mock("../captions/components/CaptionTimeline", () => ({ CaptionTimeline: () => null }));

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

afterEach(() => {
  document.body.innerHTML = "";
  hookMocks.useTimelineSelectionPreviewSync.mockClear();
});

const shell = (readOnlyPreview?: boolean) => (
  <EditorShell
    panels={null}
    timelineToolbar={null}
    renderClipContent={() => null}
    handleTimelineElementDelete={vi.fn()}
    handleTimelineAssetDrop={vi.fn()}
    handleTimelineFileDrop={vi.fn()}
    handleTimelineElementMove={vi.fn()}
    handleTimelineElementsMove={vi.fn()}
    handleTimelineElementResize={vi.fn()}
    handleTimelineGroupResize={vi.fn()}
    handleToggleTrackHidden={vi.fn()}
    setAudioGroupAttribute={{ setLive: vi.fn(), setQuiet: vi.fn() }}
    handleBlockedTimelineEdit={vi.fn()}
    handleTimelineElementSplit={vi.fn()}
    handleRazorSplit={vi.fn()}
    handleRazorSplitAll={vi.fn()}
    onCopyClip={vi.fn(() => false)}
    onPasteClip={vi.fn(async () => {})}
    onDuplicateClip={vi.fn(async () => false)}
    canPasteClip={vi.fn(() => false)}
    setCompIdToSrc={vi.fn()}
    setCompositionLoading={vi.fn()}
    shouldShowMotionPath={false}
    shouldShowSelectedDomBounds={false}
    readOnlyPreview={readOnlyPreview}
  />
);

describe("EditorShell timeline selection sync", () => {
  it("keeps the timeline store mirrored into the preview selection", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(shell());
    });

    expect(hookMocks.useTimelineSelectionPreviewSync).toHaveBeenCalledOnce();
    expect(hookMocks.useTimelineSelectionPreviewSync).toHaveBeenCalledWith(
      expect.objectContaining({
        activeCompPath: "index.html",
        timelineElements: [],
        domEditSelection: null,
        domEditGroupSelections: [],
      }),
    );

    act(() => root.unmount());
  });

  it("turns the preview read-only from the prop and back off on unmount", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => root.render(shell(true)));
    expect(isPreviewReadOnly()).toBe(true);
    act(() => root.render(shell(false)));
    expect(isPreviewReadOnly()).toBe(false);
    act(() => root.render(shell(true)));
    act(() => root.unmount());
    expect(isPreviewReadOnly()).toBe(false);
  });
});
