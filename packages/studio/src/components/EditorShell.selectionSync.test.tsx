// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorShell } from "./EditorShell";

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
    containerRef: { current: null },
  }),
}));
vi.mock("./nle/useTimelineEditCallbacks", () => ({
  useTimelineEditCallbacks: () => ({}),
}));
vi.mock("./nle/PreviewPane", () => ({ PreviewPane: () => null }));
vi.mock("./nle/PreviewOverlays", () => ({ PreviewOverlays: () => null }));
vi.mock("./nle/TimelinePane", () => ({ TimelinePane: () => null }));
vi.mock("../captions/components/CaptionTimeline", () => ({ CaptionTimeline: () => null }));
vi.mock("./StudioFeedbackBar", () => ({ StudioFeedbackBar: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  document.body.innerHTML = "";
  hookMocks.useTimelineSelectionPreviewSync.mockClear();
});

describe("EditorShell timeline selection sync", () => {
  it("keeps the timeline store mirrored into the preview selection", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    act(() => {
      root.render(
        <EditorShell
          left={null}
          right={null}
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
          handleBlockedTimelineEdit={vi.fn()}
          handleTimelineElementSplit={vi.fn()}
          handleRazorSplit={vi.fn()}
          handleRazorSplitAll={vi.fn()}
          setCompIdToSrc={vi.fn()}
          setCompositionLoading={vi.fn()}
          shouldShowMotionPath={false}
          shouldShowSelectedDomBounds={false}
        />,
      );
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
});
