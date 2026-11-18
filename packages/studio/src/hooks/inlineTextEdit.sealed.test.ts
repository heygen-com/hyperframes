// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EDITING_PROTOCOL_VERSION } from "@hyperframes/core/runtime/editing-port";
import {
  findPreviewElementForSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import { canEditSealedTextInline } from "../components/editor/domEditInlineText";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { useDomEditTextCommits } from "./useDomEditTextCommits";
import { useInlineTextEdit, type InlineTextEditCommit } from "./useInlineTextEdit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unmounts: Array<() => void> = [];
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => act(unmount));
  document.body.innerHTML = "";
});

const PATH = "index.html";
const ORIGINAL = "Hello <b>world</b>";

async function sealedTitle(ports: MessagePort[] = []) {
  document.body.innerHTML = `<h1 id="title">${ORIGINAL}</h1><p id="other">x</p>`;
  const title = document.getElementById("title")!;
  const { iframe } = sealedPreviewFrame({
    wrapHandedOverPort: (port) => (ports.push(port), port),
  });
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "title", sourceFile: PATH },
    PATH,
  );
  const selection = await resolvePreviewSelection(iframe, found!, {
    activeCompositionPath: PATH,
    isMasterView: false,
    skipSourceProbe: true,
  });
  return { title, iframe, selection: selection! };
}

function mount(render: () => void) {
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(() => (render(), null))));
  unmounts.push(() => root.unmount());
}

function inlineEditor() {
  const onCommit = vi.fn<(commit: InlineTextEditCommit) => void>();
  let controls!: ReturnType<typeof useInlineTextEdit>;
  mount(() => {
    controls = useInlineTextEdit({ onCommit });
  });
  return { onCommit, controls: () => controls };
}

it("opens a sealed element for typing in the frame and saves what the frame kept", async () => {
  const { title, selection } = await sealedTitle();
  const { onCommit, controls } = inlineEditor();
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Hi <b>there</b>";
  act(() => controls().commit());
  await vi.waitFor(() =>
    expect(onCommit).toHaveBeenCalledWith({
      element: selection.element,
      html: "Hi <b>there</b>",
      previousHtml: ORIGINAL,
    }),
  );
  expect(title.hasAttribute("contenteditable")).toBe(false);
  expect(controls().session).toBeNull();
});

it("saves when Enter in the frame ends the edit", async () => {
  const { title, selection } = await sealedTitle();
  const { onCommit, controls } = inlineEditor();
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Typed";
  title.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
  await vi.waitFor(() =>
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ html: "Typed" })),
  );
  expect(controls().session).toBeNull();
});

it("puts the frame's text back on cancel and saves nothing", async () => {
  const { title, selection } = await sealedTitle();
  const { onCommit, controls } = inlineEditor();
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.textContent = "discarded";
  act(() => controls().cancel());
  await vi.waitFor(() => expect(title.innerHTML).toBe(ORIGINAL));
  expect(onCommit).not.toHaveBeenCalled();
});

it("ignores an ended edit for another element", async () => {
  const ports: MessagePort[] = [];
  const { title, selection } = await sealedTitle(ports);
  const { onCommit, controls } = inlineEditor();
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  const data = {
    v: EDITING_PROTOCOL_VERSION,
    event: "text-edit-ended",
    handle: "0123456789abcdef:999",
    html: "forged",
    previous: "",
  };
  act(() => void ports[0]!.onmessage?.(new MessageEvent("message", { data })));
  expect(onCommit).not.toHaveBeenCalled();
  expect(controls().session).not.toBeNull();
});

it("saves a sealed rich text commit and puts the frame's text back when the save fails", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const persist = vi.fn<PersistDomEditOperations>(async () => {
    throw new Error("disk full");
  });
  let commits!: ReturnType<typeof useDomEditTextCommits>;
  mount(() => {
    commits = useDomEditTextCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: vi.fn(async () => null),
      persistDomEditOperations: persist,
      resolveImportedFontAsset: () => null,
      readOnlyPreview: false,
    });
  });
  title.innerHTML = "Typed";
  await act(() =>
    commits.handleDomRichTextCommit({
      element: selection.element,
      html: "Typed",
      previousHtml: ORIGINAL,
    }),
  );
  expect(persist).toHaveBeenCalledOnce();
  expect(persist.mock.calls[0]![1]).toEqual([expect.objectContaining({ type: "rich-text" })]);
  await vi.waitFor(() => expect(title.innerHTML).toBe(ORIGINAL));
});

it("opens a sealed text edit on a plain element, never on a host, a locked one or the page", async () => {
  const { selection } = await sealedTitle();
  expect(canEditSealedTextInline(selection)).toBe(true);
  expect(canEditSealedTextInline({ ...selection, isCompositionHost: true })).toBe(false);
  expect(canEditSealedTextInline({ ...selection, isInsideLockedComposition: true })).toBe(false);
  expect(canEditSealedTextInline({ ...selection, tagName: "body" })).toBe(false);
  expect(canEditSealedTextInline({ ...selection, handle: undefined })).toBe(false);
});
