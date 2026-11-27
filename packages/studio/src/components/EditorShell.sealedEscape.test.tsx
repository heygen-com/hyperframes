// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import "./EditorShellTestMocks";
import { EditorShell } from "./EditorShell";
import { cancelFromSealedCanvas } from "./editor/useSealedCanvasKeys";
import { useNLEContext } from "./nle/NLEContext";

vi.mock("../hooks/useTimelineSelectionPreviewSync", () => ({
  useTimelineSelectionPreviewSync: vi.fn(),
}));
vi.mock("./nle/PreviewOverlays", () => ({ PreviewOverlays: () => null }));
const nle: { current: ReturnType<typeof useNLEContext> | null } = { current: null };
vi.mock("./nle/PreviewPane", () => ({
  PreviewPane: () => {
    nle.current = useNLEContext();
    return null;
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mountShell() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
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
      />,
    ),
  );
}

const level = (id: string) => ({ id, label: id, previewUrl: `/preview/${id}` });
const stackIds = () => nle.current!.compositionStack.map((entry) => entry.id);

it("a sealed frame's no-press Escape leaves a nested composition, as Escape does unsealed", () => {
  mountShell();
  const levels = [level("master"), level("scene.html"), level("intro.html")];
  act(() => nle.current!.updateCompositionStack(levels));
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  act(() => void nle.current!.containerRef.current!.dispatchEvent(escape));
  expect(stackIds()).toEqual(["master", "scene.html"]);

  act(() => cancelFromSealedCanvas());
  expect(stackIds()).toEqual(["master"]);
  act(() => cancelFromSealedCanvas());
  expect(stackIds()).toEqual(["master"]);
});
