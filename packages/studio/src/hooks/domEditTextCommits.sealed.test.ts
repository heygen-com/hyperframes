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
import { useDomEditTextCommits } from "./useDomEditTextCommits";

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
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "card", sourceFile: PATH },
    PATH,
  );
  const selection = await resolvePreviewSelection(iframe, found!, {
    activeCompositionPath: PATH,
    isMasterView: false,
    skipSourceProbe: true,
  });
  return { card, iframe, selection: selection! };
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

function textCommits(
  iframe: HTMLIFrameElement,
  selection: DomEditSelection,
  persist: PersistDomEditOperations,
) {
  const refresh = vi.fn();
  let commits: ReturnType<typeof useDomEditTextCommits> | undefined;
  function Harness() {
    commits = useDomEditTextCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: refresh,
      buildDomSelectionFromTarget: vi.fn(async () => null),
      persistDomEditOperations: persist,
      resolveImportedFontAsset: () => null,
      readOnlyPreview: false,
    });
    return null;
  }
  act(() => createRoot(document.createElement("div")).render(createElement(Harness)));
  return { commits: commits!, refresh };
}

describe("text edits in a sealed preview", () => {
  it("gives a sealed selection the text fields of its element", async () => {
    const { selection } = await sealedCard(
      `<div id="card"><span>First</span><span style="color: red">Second</span></div>`,
    );
    expect(selection.textFields.map((field) => [field.source, field.value])).toEqual([
      ["child", "First"],
      ["child", "Second"],
    ]);
    expect(selection.textFields[1]!.computedStyles.color).toMatch(/red|255, 0, 0/);
  });

  it("draws a text commit on the frame's element and re-reads the selection", async () => {
    const { card, iframe, selection } = await sealedCard(`<h1 id="card">Old</h1>`);
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    const { commits, refresh } = textCommits(iframe, selection, persist);
    const outcome = await act(() => commits.handleDomTextCommitForSelection(selection, "New <b>"));
    await settle();
    expect(outcome.ok).toBe(true);
    expect(card.textContent).toBe("New <b>");
    expect(persist.mock.calls[0]?.[2]).toMatchObject({ skipRefresh: true });
    expect(refresh).toHaveBeenCalledWith(selection);
  });

  it("draws a field commit and puts the text back when the save fails", async () => {
    const { card, iframe, selection } = await sealedCard(
      `<div id="card"><span>First</span><span>Second</span></div>`,
    );
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    const { commits } = textCommits(iframe, selection, persist);
    await act(() =>
      commits.handleDomTextCommitForSelection(selection, "Changed", selection.textFields[1]!.key),
    );
    await settle();
    expect(card.children[1]!.textContent).toBe("Changed");

    persist.mockRejectedValueOnce(new Error("disk full"));
    await act(() =>
      commits.handleDomTextCommitForSelection(selection, "Lost", selection.textFields[0]!.key),
    );
    await settle();
    expect(card.children[0]!.textContent).toBe("First");
  });
});
