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
const shells: ReturnType<typeof useNLEContext>[] = [];
vi.mock("./nle/PreviewPane", () => ({
  PreviewPane: () => {
    const nle = useNLEContext();
    if (!shells.includes(nle)) shells.push(nle);
    return (
      <div
        data-player=""
        ref={(player) => {
          if (player && !player.shadowRoot)
            player.attachShadow({ mode: "open" }).append(document.createElement("iframe"));
        }}
      />
    );
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  shells.length = 0;
  document.body.innerHTML = "";
});

function mountShell(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
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
  return host;
}

const level = (id: string) => ({ id, label: id, previewUrl: `/preview/${id}` });
const latest = (host: HTMLElement) =>
  shells.filter((shell) => host.contains(shell.containerRef.current)).at(-1)!;
const stackIds = (host: HTMLElement) => latest(host).compositionStack.map((entry) => entry.id);

it("a sealed frame's no-press Escape leaves its own shell's nested composition, as Escape does unsealed", () => {
  const first = mountShell();
  const second = mountShell();
  const levels = [level("master"), level("scene.html"), level("intro.html")];
  act(() => latest(first).updateCompositionStack(levels));
  act(() => latest(second).updateCompositionStack(levels));
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  act(() => void latest(first).containerRef.current!.dispatchEvent(escape));
  expect(stackIds(first)).toEqual(["master", "scene.html"]);
  expect(stackIds(second)).toHaveLength(3);

  const frame = first.querySelector("[data-player]")!.shadowRoot!.querySelector("iframe")!;
  expect(first.contains(frame)).toBe(false);
  act(() => cancelFromSealedCanvas(frame));
  expect(stackIds(first)).toEqual(["master"]);
  expect(stackIds(second)).toHaveLength(3);
  act(() => cancelFromSealedCanvas(frame));
  expect(stackIds(first)).toEqual(["master"]);
});
