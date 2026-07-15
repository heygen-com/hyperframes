// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorShell } from "./EditorShell";

let captionEditMode = true;

vi.mock("../contexts/StudioContext", () => ({
  useStudioPlaybackContext: () => ({
    captionEditMode,
    refreshKey: 0,
    refreshPreviewDocumentVersion: vi.fn(),
  }),
  useStudioShellContext: () => ({
    projectId: "project-1",
    activeCompPath: "index.html",
    setActiveCompPath: vi.fn(),
    handlePreviewIframeRef: vi.fn(),
  }),
}));

vi.mock("../contexts/DomEditContext", () => ({
  useDomEditActionsContext: () => ({ handleTimelineElementSelect: vi.fn() }),
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
vi.mock("./nle/TimelinePane", () => ({
  TimelinePane: ({ timelineFooter }: { timelineFooter?: React.ReactNode }) =>
    timelineFooter ?? null,
}));
vi.mock("../captions/components/CaptionTimeline", () => ({
  CaptionTimeline: () => "Caption timeline",
}));
vi.mock("./StudioFeedbackBar", () => ({ StudioFeedbackBar: () => null }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

beforeEach(() => {
  captionEditMode = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderShell(): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);

  function Harness() {
    const [active, setActive] = useState(true);
    captionEditMode = active;
    return (
      <EditorShell
        left={null}
        right={<div>{active ? "Caption inspector" : "Normal inspector panel"}</div>}
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
        shouldShowSelectedDomBounds={false}
        onExitCaptionMode={() => setActive(false)}
      />
    );
  }

  act(() => root?.render(<Harness />));
}

describe("EditorShell caption mode", () => {
  it("shows a visible exit control on the caption rail", () => {
    renderShell();

    expect(document.body.textContent).toContain("Caption timeline");
    const exitButton = document.querySelector('button[aria-label="Exit caption mode"]');
    expect(exitButton).toBeInstanceOf(HTMLButtonElement);
  });

  it("restores the normal inspector when the caption mode exit is clicked", () => {
    renderShell();

    const exitButton = document.querySelector('button[aria-label="Exit caption mode"]');
    if (!(exitButton instanceof HTMLButtonElement)) {
      throw new Error("caption mode exit button not rendered");
    }
    act(() => exitButton.click());

    expect(document.body.textContent).toContain("Normal inspector panel");
    expect(document.body.textContent).not.toContain("Caption timeline");
  });
});
