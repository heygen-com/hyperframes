// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
// The frame's real runtime agent, serving the opaque frame from this document.
import { installMarkedEditingAgent } from "../../../core/src/runtime/editingAgent.test-helpers";
import { detachedFakeIframe } from "../player/hooks/timelinePlayerTestHarness";
import {
  findPreviewElementForSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { commitDomStyles } from "./domStyleCommit";
import { readElementCropInsets } from "../components/editor/domEditOverlayCrop";
import { applyUndoRestoreToPreview } from "../utils/gsapUndoRestore";
import { onPreviewRestoredInPlace } from "../player/sceneSwap";
import { useDomEditAttributeCommits } from "./useDomEditAttributeCommits";
import { usePlayerStore } from "../player/store/playerStore";
import { syncStoredAutomationFromFrame } from "../player/lib/automationStoreSync";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  document.body.innerHTML = "";
});

/** A frame Studio cannot read, whose runtime is the real editing agent over this document. */
function opaqueFrame(): HTMLIFrameElement {
  const frame: Record<string, unknown> = {};
  const iframe = detachedFakeIframe(frame);
  Object.defineProperty(iframe, "contentDocument", { value: null });
  Object.defineProperty(frame, "document", {
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  const parent = {
    postMessage: (data: unknown, _origin: string, ports: MessagePort[]) =>
      window.dispatchEvent(
        new MessageEvent("message", { source: frame as unknown as Window, data, ports }),
      ),
  } as unknown as Window;
  const agent = installMarkedEditingAgent(parent);
  frame.postMessage = (data: unknown) =>
    window.dispatchEvent(new MessageEvent("message", { source: parent, data }));
  closers.push(() => agent.dispose());
  return iframe;
}

const PATH = "index.html";

async function sealedCard(markup: string) {
  document.body.innerHTML = markup;
  const card = document.getElementById("card")!;
  const iframe = opaqueFrame();
  const target = { id: "card", sourceFile: PATH };
  const found = await findPreviewElementForSelection(iframe, target, PATH);
  const selection = await resolvePreviewSelection(iframe, found!, {
    activeCompositionPath: PATH,
    isMasterView: false,
    skipSourceProbe: true,
  });
  return { card, iframe, selection: selection! };
}

/** Lets the port's request and the frame's reply land. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

function styleContext(iframe: HTMLIFrameElement, persist: PersistDomEditOperations) {
  return {
    activeCompPath: PATH,
    previewIframeRef: { current: iframe },
    persistDomEditOperations: persist,
    showToast: vi.fn(),
    versions: new Map<string, symbol>(),
  };
}

function attributeCommits(
  iframe: HTMLIFrameElement,
  selection: DomEditSelection,
  persist: PersistDomEditOperations,
) {
  let commits: ReturnType<typeof useDomEditAttributeCommits> | undefined;
  function Harness() {
    commits = useDomEditAttributeCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      domEditSelection: selection,
      refreshDomEditSelectionFromPreview: vi.fn(),
      persistDomEditOperations: persist,
    });
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(createElement(Harness)));
  return commits!;
}

describe("DOM edit commits in a sealed preview", () => {
  it("draws a style commit on the frame's element and saves it without a reload", async () => {
    const { card, iframe, selection } = await sealedCard(`<div id="card">Hi</div>`);
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    const outcome = await commitDomStyles(styleContext(iframe, persist), selection, {
      opacity: "0.5",
    });
    await settle();
    expect(outcome.ok).toBe(true);
    expect(card.style.opacity).toBe("0.5");
    expect(persist.mock.calls[0]?.[2]).toMatchObject({ skipRefresh: true });
  });

  it("puts the frame's style back when the save fails", async () => {
    const { card, iframe, selection } = await sealedCard(
      `<div id="card" style="color: red">Hi</div>`,
    );
    const persist = vi.fn<PersistDomEditOperations>(async () => {
      throw new Error("disk full");
    });
    await commitDomStyles(styleContext(iframe, persist), selection, { color: "blue" });
    await settle();
    expect(card.style.color).toBe("red");
  });

  // fails without the fix: a sealed crop's release drew the press-time crop until the save's resync.
  it("shows a sealed style commit on the selection at once, before the save lands", async () => {
    const { iframe, selection } = await sealedCard(`<div id="card">Hi</div>`);
    let land = () => {};
    const persist = vi.fn<PersistDomEditOperations>(
      () => new Promise<void>((resolve) => (land = resolve)),
    );
    const saved = commitDomStyles(styleContext(iframe, persist), selection, {
      "clip-path": "inset(0px 40px 0px 0px)",
      opacity: "0.5",
    });
    await settle();
    expect(persist).toHaveBeenCalled();
    expect(readElementCropInsets(selection.element)).toMatchObject({ right: 40 });
    expect(selection.element.style.opacity).toBe("0.5");
    land();
    await saved;
  });

  it("puts the selection's own style back exactly when a sealed save fails", async () => {
    const { iframe, selection } = await sealedCard(
      `<div id="card" style="clip-path: inset(10px)">Hi</div>`,
    );
    const before = selection.element.getAttribute("style");
    const persist = vi.fn<PersistDomEditOperations>(async () => {
      throw new Error("disk full");
    });
    await commitDomStyles(styleContext(iframe, persist), selection, {
      "clip-path": "inset(20px)",
    });
    await settle();
    expect(selection.element.getAttribute("style")).toBe(before);
    expect(readElementCropInsets(selection.element)).toMatchObject({ top: 10, right: 10 });
  });

  // fails without the fix: an in-place undo never re-read the selection, which kept drawing the undone crop.
  it("shows the undone crop on the selection after a sealed undo restores it in place", async () => {
    const page = (clip: string) =>
      `<div data-composition-id="main"><div id="card" data-hf-id="card" style="clip-path: ${clip}">Hi</div></div>`;
    const { card, iframe, selection } = await sealedCard(page("inset(10px)"));
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    await commitDomStyles(styleContext(iframe, persist), selection, { "clip-path": "inset(20px)" });
    await settle();
    expect(readElementCropInsets(selection.element)).toMatchObject({ top: 20 });

    Object.assign(window, { __player: { seek: () => {} } });
    closers.push(() => Reflect.deleteProperty(window, "__player"));
    const reReadSelection = async () => {
      const found = await findPreviewElementForSelection(
        iframe,
        { id: "card", sourceFile: PATH },
        PATH,
      );
      await resolvePreviewSelection(iframe, found!, {
        activeCompositionPath: PATH,
        isMasterView: false,
        skipSourceProbe: true,
      });
    };
    const html = (clip: string) => `<html><body>${page(clip)}</body></html>`;
    const files = { [PATH]: { previous: html("inset(20px)"), restored: html("inset(10px)") } };
    const reload = vi.fn();
    closers.push(onPreviewRestoredInPlace(iframe, () => void reReadSelection()));
    const strategy = applyUndoRestoreToPreview(iframe, PATH, files, 0, reload);
    await settle();
    await settle();

    expect(strategy).toBe("soft");
    expect(reload).not.toHaveBeenCalled();
    expect(card.style.clipPath).toBe("inset(10px)");
    expect(readElementCropInsets(selection.element)).toMatchObject({ top: 10 });
  });

  it("reloads a sealed frame for a font change, which it cannot load from Studio", async () => {
    const { iframe, selection } = await sealedCard(`<div id="card">Hi</div>`);
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    await commitDomStyles(styleContext(iframe, persist), selection, { "font-family": "Inter" });
    expect(persist.mock.calls[0]?.[2]).toMatchObject({ skipRefresh: false });
  });

  it("reloads when the frame no longer has the element to draw on", async () => {
    const { card, iframe, selection } = await sealedCard(`<div id="card">Hi</div>`);
    card.remove();
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    await commitDomStyles(styleContext(iframe, persist), selection, { opacity: "0.5" });
    expect(persist.mock.calls[0]?.[2]).toMatchObject({ skipRefresh: false });
  });

  it("reloads when the frame refuses the edit", async () => {
    const { card, iframe, selection } = await sealedCard(`<div id="card">Hi</div>`);
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    const tooLong = `"${"x".repeat(200_001)}"`;
    await commitDomStyles(styleContext(iframe, persist), selection, {
      "font-feature-settings": tooLong,
    });
    expect(persist.mock.calls[0]?.[2]).toMatchObject({ skipRefresh: false });
    expect(card.style.fontFeatureSettings).toBe("");
  });

  it("draws data and HTML attribute commits on the frame's element", async () => {
    const { card, iframe, selection } = await sealedCard(`<div id="card" data-volume="1">Hi</div>`);
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    const commits = attributeCommits(iframe, selection, persist);
    await act(() => commits.handleDomAttributeQuietCommit("volume", "0.25"));
    await act(() => commits.handleDomHtmlAttributeCommit("title", "Card"));
    await settle();
    expect(card.dataset.volume).toBe("0.25");
    expect(card.getAttribute("title")).toBe("Card");
  });

  it("records a sealed automation save in the timeline's store", async () => {
    const { iframe, selection } = await sealedCard(`<audio id="card" data-volume="1"></audio>`);
    const clip = { id: "card", key: "card", tag: "audio", start: 0, duration: 4, track: 1 };
    usePlayerStore.setState({ elements: [{ ...clip, domId: "card", volume: 1 }] });
    const commits = attributeCommits(
      iframe,
      selection,
      vi.fn(async () => undefined),
    );
    await act(() => commits.handleDomAttributeQuietCommit("volume", "0.25"));
    await vi.waitFor(() => expect(usePlayerStore.getState().elements[0]?.volume).toBe(0.25));
    usePlayerStore.getState().reset();
  });

  it("drops a sealed lane read when the frame loads before it answers", async () => {
    const { iframe } = await sealedCard(`<audio id="card" data-volume="0.25"></audio>`);
    const clip = { id: "card", key: "card", tag: "audio", start: 0, duration: 4, track: 1 };
    usePlayerStore.setState({ elements: [{ ...clip, domId: "card", volume: 1 }] });
    syncStoredAutomationFromFrame(iframe);
    iframe.dispatchEvent(new Event("load"));
    await settle();
    expect(usePlayerStore.getState().elements[0]?.volume).toBe(1);
    syncStoredAutomationFromFrame(iframe);
    await vi.waitFor(() => expect(usePlayerStore.getState().elements[0]?.volume).toBe(0.25));
    usePlayerStore.getState().reset();
  });

  it("never puts back a value over a newer edit that saved", async () => {
    const { card, iframe, selection } = await sealedCard(
      `<div id="card" title="original">Hi</div>`,
    );
    let saves = 0;
    const persist = vi.fn<PersistDomEditOperations>(async () => {
      if (saves++ === 0) throw new Error("disk full");
    });
    const commits = attributeCommits(iframe, selection, persist);
    await act(async () => {
      const first = commits.handleDomHtmlAttributeCommit("title", "first");
      for (let i = 0; i < 5; i++) await Promise.resolve();
      await Promise.all([first, commits.handleDomHtmlAttributeCommit("title", "second")]);
    });
    await settle();
    expect(card.getAttribute("title")).toBe("second");
  });

  it("puts the frame's attributes back when a batch save fails", async () => {
    const { card, iframe, selection } = await sealedCard(
      `<div id="card" data-start="1" data-duration="2">Hi</div>`,
    );
    const persist = vi.fn<PersistDomEditOperations>(async () => {
      throw new Error("disk full");
    });
    const commits = attributeCommits(iframe, selection, persist);
    await act(() => commits.handleDomAttributesCommit(selection, { start: "3", duration: "4" }));
    await settle();
    expect([card.dataset.start, card.dataset.duration]).toEqual(["1", "2"]);
  });
});
