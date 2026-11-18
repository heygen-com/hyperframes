// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EDITING_PROTOCOL_VERSION } from "@hyperframes/core/runtime/editing-port";
import {
  findPreviewElementForSelection,
  resolveFoundSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import type { DomEditSelection } from "../components/editor/domEditing";
import { canEditSealedTextInline } from "../components/editor/domEditInlineText";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { useDomEditTextCommits } from "./useDomEditTextCommits";
import { useInlineTextEdit, type InlineTextEditCommit } from "./useInlineTextEdit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wake = vi.hoisted(() => vi.fn());
vi.mock("../components/editor/overlayFrameLoop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/editor/overlayFrameLoop")>()),
  requestOverlayFrames: wake,
}));

const unmounts: Array<() => void> = [];
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => act(unmount));
  document.body.innerHTML = "";
});

const PATH = "index.html";
const ORIGINAL = "Hello <b>world</b>";

const OPTIONS = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };

async function select(iframe: HTMLIFrameElement, id: string) {
  const found = await findPreviewElementForSelection(iframe, { id, sourceFile: PATH }, PATH);
  return (await resolvePreviewSelection(iframe, found!, OPTIONS))!;
}

async function sealedTitle(ports: MessagePort[] = []) {
  document.body.innerHTML = `<h1 id="title">${ORIGINAL}</h1><p id="other">x</p>`;
  const title = document.getElementById("title")!;
  const { iframe } = sealedPreviewFrame({
    wrapHandedOverPort: (port) => (ports.push(port), port),
  });
  return { title, iframe, selection: await select(iframe, "title") };
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

function textCommits(
  iframe: HTMLIFrameElement,
  current: DomEditSelection | null,
  persist: PersistDomEditOperations,
) {
  let commits!: ReturnType<typeof useDomEditTextCommits>;
  mount(() => {
    commits = useDomEditTextCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      domEditSelection: current,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: (target, options) =>
        resolveFoundSelection(iframe, target, { ...OPTIONS, ...options }),
      persistDomEditOperations: persist,
      resolveImportedFontAsset: () => null,
      readOnlyPreview: false,
    });
  });
  return (element: HTMLElement, html: string) =>
    act(() => commits.handleDomRichTextCommit({ element, html, previousHtml: ORIGINAL }));
}

it("wakes the selection box as the frame's text grows, and stops watching when the edit ends", async () => {
  const ports: MessagePort[] = [];
  const { title, selection } = await sealedTitle(ports);
  const studioPort = ports[0]!;
  const sent = vi.spyOn(studioPort, "postMessage");
  const watched = () =>
    sent.mock.calls
      .map(([message]) => message as { kind?: string; params?: { handles: string[] } })
      .filter((message) => message.kind === "watch-geometry")
      .map((message) => message.params!.handles);
  const { controls } = inlineEditor();
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  await vi.waitFor(() => expect(watched()).toEqual([[selection.handle]]));
  const grown = (width: number) => {
    const rect = { x: 0, y: 0, width, height: 40 };
    const box = {
      rect,
      angle: 0,
      corners: null,
      source: null,
      clipPath: null,
      visible: true,
      members: null,
    };
    const data = { v: EDITING_PROTOCOL_VERSION, event: "geometry", at: 1, elements: [box] };
    studioPort.onmessage?.(new MessageEvent("message", { data }));
  };
  wake.mockClear();
  grown(100);
  grown(100);
  grown(140);
  expect(wake).toHaveBeenCalledTimes(2);
  act(() => controls().cancel());
  await vi.waitFor(() => expect(watched().at(-1)).toEqual([]));
});

it("saves a sealed rich text commit and puts the frame's text back when the save fails", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const persist = vi.fn<PersistDomEditOperations>(async () => {
    throw new Error("disk full");
  });
  title.innerHTML = "Typed";
  await textCommits(iframe, selection, persist)(selection.element, "Typed");
  expect(persist).toHaveBeenCalledOnce();
  expect(persist.mock.calls[0]![1]).toEqual([expect.objectContaining({ type: "rich-text" })]);
  await vi.waitFor(() => expect(title.innerHTML).toBe(ORIGINAL));
});

it("saves a sealed edit whose selection was cleared or moved before the frame's reply", async () => {
  const { title, iframe, selection } = await sealedTitle();
  for (const current of [null, await select(iframe, "other")]) {
    const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
    title.innerHTML = "Typed";
    await textCommits(iframe, current, persist)(selection.element, "Typed");
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0]![0].element).toBe(selection.element);
  }
});

it("opens a sealed text edit on a plain element, never on a host, a locked one or the page", async () => {
  const { selection } = await sealedTitle();
  expect(canEditSealedTextInline(selection)).toBe(true);
  expect(canEditSealedTextInline({ ...selection, isCompositionHost: true })).toBe(false);
  expect(canEditSealedTextInline({ ...selection, isInsideLockedComposition: true })).toBe(false);
  expect(canEditSealedTextInline({ ...selection, tagName: "body" })).toBe(false);
  expect(canEditSealedTextInline({ ...selection, handle: undefined })).toBe(false);
});
