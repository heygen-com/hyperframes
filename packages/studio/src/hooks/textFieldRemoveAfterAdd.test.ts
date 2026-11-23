// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";
import { resolveDomEditSelection } from "../components/editor/domEditingLayers";
import {
  findPreviewElementForSelection,
  resolveFoundSelection,
} from "../components/editor/previewSelection";
import { retirePreviewEditingClient } from "../player/lib/previewChannel";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import { flushStudioPendingEdits } from "../utils/studioPendingEdits";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { useDomEditTextCommits } from "./useDomEditTextCommits";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "index.html";
const OPTIONS = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };
const SPANS = "<span>One</span> <span>Two</span>";
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.innerHTML = "";
});

function frameFor(mode: "live" | "sealed") {
  const html = `<h1 id="title">${SPANS}</h1><p id="other">x</p>`;
  if (mode === "live") {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    iframe.contentDocument!.body.innerHTML = html;
    return iframe;
  }
  document.body.innerHTML = html;
  const { iframe } = sealedPreviewFrame();
  cleanups.push(() => retirePreviewEditingClient(iframe));
  return iframe;
}

async function setUp(mode: "live" | "sealed") {
  const iframe = frameFor(mode);
  const selection = (await (mode === "live"
    ? resolveDomEditSelection(iframe.contentDocument!.getElementById("title")!, OPTIONS)
    : findPreviewElementForSelection(iframe, { id: "title", sourceFile: PATH }, PATH).then(
        (found) => resolveFoundSelection(iframe, found!, OPTIONS),
      )))!;
  let file = `<h1 id="title">${SPANS}</h1><p id="other">x</p>`;
  const persist = vi.fn<PersistDomEditOperations>(async (sel, operations, options) => {
    if (options?.shouldSave?.() === false) return;
    file = patchElementInHtml(file, { id: sel.id }, operations).html;
  });
  let commits!: ReturnType<typeof useDomEditTextCommits>;
  const root = createRoot(document.createElement("div"));
  function Harness() {
    commits = useDomEditTextCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      reloadPreview: vi.fn(),
      // The panel still shows the rows from before the add.
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: (target, options) =>
        resolveFoundSelection(iframe, target, { ...OPTIONS, ...options }),
      persistDomEditOperations: persist,
      resolveImportedFontAsset: () => null,
      readOnlyPreview: false,
    });
    return null;
  }
  act(() => root.render(createElement(Harness)));
  cleanups.push(() => act(() => root.unmount()));
  const text = () =>
    new DOMParser()
      .parseFromString(file, "text/html")
      .getElementById("title")!
      .innerHTML.replace(/ (data-hf-[a-z-]+|style)="[^"]*"/g, "");
  return { selection, commits: () => commits, text };
}

describe.each(["live", "sealed"] as const)("a Design panel remove on a %s preview", (mode) => {
  it("removes only the row clicked when the panel still shows the rows from before an add", async () => {
    const { selection, commits, text } = await setUp(mode);
    const [one, two] = selection.textFields;
    await act(() => commits().handleDomAddTextField(one!.key));
    await act(() => flushStudioPendingEdits());
    await act(() => commits().handleDomRemoveTextField(two!.key));
    await act(() => flushStudioPendingEdits());
    expect(text()).toBe("<span>One</span><span>New text</span>");
  });

  it("removes only the row clicked while an add made just before it is still saving", async () => {
    const { selection, commits, text } = await setUp(mode);
    const [one, two] = selection.textFields;
    const adding = commits().handleDomAddTextField(one!.key);
    const removing = commits().handleDomRemoveTextField(two!.key);
    await act(() => Promise.allSettled([adding, removing]));
    await act(() => flushStudioPendingEdits());
    expect(text()).toBe("<span>One</span><span>New text</span>");
  });
});
