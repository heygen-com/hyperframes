// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewModeProvider, useViewModeState } from "../../contexts/ViewModeContext";
import { ViewModeToggle } from "../StudioHeader";
import { StoryboardFrameFocus } from "./StoryboardFrameFocus";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../contexts/FileManagerContext", () => ({
  useFileManagerContext: () => ({
    readProjectFile: vi.fn(),
    writeProjectFile: vi.fn(),
  }),
}));

vi.mock("../../utils/studioTelemetry", () => ({
  trackStudioEvent: vi.fn(),
}));

vi.mock("./FramePoster", () => ({
  FramePoster: () => <div>poster</div>,
  posterTime: () => 0,
}));

const onSelectComposition = vi.fn();

function TestApp() {
  const viewMode = useViewModeState();
  return (
    <ViewModeProvider value={viewMode}>
      <span data-view-mode={viewMode.viewMode}>{viewMode.viewMode}</span>
      <ViewModeToggle />
      {viewMode.viewMode === "storyboard" && (
        <StoryboardFrameFocus
          projectId="project"
          storyboardPath="STORYBOARD.md"
          frame={{
            index: 1,
            number: 1,
            title: "Opening",
            status: "built",
            src: "frames/01-opening.html",
            srcExists: true,
            voiceover: "Original voiceover",
            narrative: "",
            extra: {},
          }}
          frameCount={1}
          onBack={vi.fn()}
          onNavigate={vi.fn()}
          onSaved={vi.fn()}
          onSelectComposition={onSelectComposition}
          scriptExists={false}
          commentDraft=""
          onCommentDraftChange={vi.fn()}
          pendingComment={null}
          pendingCommentCount={0}
          commentDraftCount={0}
          commentsSubmitState="idle"
          commentsSubmitError={null}
          feedbackMessageCopied={false}
          onFeedbackMessageCopied={vi.fn()}
          onSaveFeedback={vi.fn()}
        />
      )}
    </ViewModeProvider>
  );
}

function renderApp(): { host: HTMLDivElement; root: Root } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<TestApp />));
  return { host, root };
}

function makeVoiceoverDirty(host: HTMLElement): void {
  const textarea = host.querySelector<HTMLTextAreaElement>(
    'textarea[placeholder^="What the narrator says"]',
  );
  if (!textarea) throw new Error("voiceover textarea not rendered");
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    valueSetter?.call(textarea, "Changed voiceover");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function clickButton(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`button not found: ${label}`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function goBack(): Promise<void> {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  window.history.replaceState({ entry: "timeline" }, "", "/");
  window.history.pushState({ entry: "storyboard" }, "", "/?view=storyboard");
  onSelectComposition.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("dirty storyboard voiceover view-mode guard", () => {
  it("guards the header Preview transition on decline and allows it on accept", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { host, root } = renderApp();
    makeVoiceoverDirty(host);

    clickButton(host, "Preview");
    expect(host.querySelector("[data-view-mode]")?.textContent).toBe("storyboard");
    expect(confirm).toHaveBeenCalledWith("Discard unsaved voiceover changes?");

    confirm.mockReturnValue(true);
    clickButton(host, "Preview");
    expect(host.querySelector("[data-view-mode]")?.textContent).toBe("timeline");
    expect(onSelectComposition).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("guards Open in Preview on decline and selects the frame only after accept", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { host, root } = renderApp();
    makeVoiceoverDirty(host);

    clickButton(host, "Open in Preview →");
    expect(host.querySelector("[data-view-mode]")?.textContent).toBe("storyboard");
    expect(onSelectComposition).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    clickButton(host, "Open in Preview →");
    expect(host.querySelector("[data-view-mode]")?.textContent).toBe("timeline");
    expect(onSelectComposition).toHaveBeenCalledWith("frames/01-opening.html");
    act(() => root.unmount());
  });

  it("guards browser history transitions on decline and allows them on accept", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { host, root } = renderApp();
    makeVoiceoverDirty(host);

    await goBack();
    expect(host.querySelector("[data-view-mode]")?.textContent).toBe("storyboard");
    expect(window.location.search).toBe("?view=storyboard");
    expect(window.history.state).toEqual({ entry: "storyboard" });
    expect(confirm).toHaveBeenCalledWith("Discard unsaved voiceover changes?");

    confirm.mockReturnValue(true);
    await goBack();
    expect(host.querySelector("[data-view-mode]")?.textContent).toBe("timeline");
    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({ entry: "timeline" });
    act(() => root.unmount());
  });
});
