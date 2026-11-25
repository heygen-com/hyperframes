// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  EDITING_PROTOCOL_VERSION,
  EDITING_REQUEST_TIMEOUT_MS,
} from "@hyperframes/core/runtime/editing-port";
import {
  findPreviewElementForSelection,
  resolveFoundSelection,
  resolvePreviewSelection,
  gestureDocumentOf,
} from "../components/editor/previewSelection";
import type { DomEditSelection } from "../components/editor/domEditing";
import {
  afterStudioManualEditGestures,
  isStudioManualEditGestureLiveIn,
} from "../components/editor/manualEditGesture";
import {
  canEditElementTextInline,
  canEditSealedTextInline,
} from "../components/editor/domEditInlineText";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import { describePreviewElements, previewTextEdit } from "../player/lib/previewElements";
import { keepKeyboardOutOfSealedFrame } from "../player/lib/sealedFrameKeyboard";
import { retirePreviewEditingClient } from "../player/lib/previewChannel";
import type { PersistDomEditOperations } from "./domEditCommitTypes";
import { useDomEditTextCommits } from "./useDomEditTextCommits";
import { previewReloadBegun, requestPreviewReload } from "../player/previewReloading";
import { useInlineTextEdit, type InlineTextEditCommit } from "./useInlineTextEdit";
import { hasStudioPendingEdits } from "../utils/studioPendingEdits";
import { patchElementInHtml } from "@hyperframes/studio-server/source-mutation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wake = vi.hoisted(() => vi.fn());
vi.mock("../components/editor/overlayFrameLoop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/editor/overlayFrameLoop")>()),
  requestOverlayFrames: wake,
}));

const unmounts: Array<() => void> = [];
const frames: HTMLIFrameElement[] = [];
const sealedFrame = (...args: Parameters<typeof sealedPreviewFrame>) => {
  const sealed = sealedPreviewFrame(...args);
  frames.push(sealed.iframe);
  return sealed;
};
afterEach(() => {
  unmounts.splice(0).forEach((unmount) => act(unmount));
  frames.splice(0).forEach(retirePreviewEditingClient);
  document.body.innerHTML = "";
});

const PATH = "index.html";
const ORIGINAL = "Hello <b>world</b>";
const SPANS = '<span data-hf-id="hf-one">One</span> <span data-hf-id="hf-two">Two</span>';
const nextTask = () => new Promise((resolve) => setTimeout(resolve));

const OPTIONS = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };

async function select(iframe: HTMLIFrameElement, id: string) {
  const found = await findPreviewElementForSelection(iframe, { id, sourceFile: PATH }, PATH);
  return (await resolvePreviewSelection(iframe, found!, OPTIONS))!;
}

async function sealedTitle(
  ports: MessagePort[] = [],
  wrap: (port: MessagePort) => MessagePort = (port) => port,
  markup = ORIGINAL,
) {
  document.body.innerHTML = `<h1 id="title">${markup}</h1><p id="other">x</p>`;
  const title = document.getElementById("title")!;
  const { iframe, reload } = sealedFrame({
    wrapHandedOverPort: (port) => (ports.push(port), wrap(port)),
  });
  return { title, iframe, reload, selection: await select(iframe, "title") };
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

const HOSTILE = [`<img src="x" onerror="alert(1)">`, `<span onclick="alert(1)">Hi</span>`];

// Studio's end of the port, with each reply that carries kept text rewritten as a hostile frame would.
function rewritingTextReplies(html: string) {
  return (port: MessagePort) =>
    ({
      postMessage: (data: unknown) => port.postMessage(data),
      start: () => port.start(),
      close: () => port.close(),
      get onmessage() {
        return port.onmessage;
      },
      set onmessage(listener: ((event: MessageEvent) => void) | null) {
        port.onmessage =
          listener &&
          ((event) => {
            const result = (event.data as { result?: { html?: unknown } }).result;
            if (typeof result?.html === "string") result.html = html;
            listener(event);
          });
      },
    }) as unknown as MessagePort;
}

it("refuses a frame's ended edit carrying anything but text markup, and puts the original back", async () => {
  for (const [html, previous] of [
    [HOSTILE[0]!, ORIGINAL],
    [HOSTILE[1]!, ORIGINAL],
    ["Typed", HOSTILE[1]!],
  ]) {
    const ports: MessagePort[] = [];
    const { title, selection } = await sealedTitle(ports);
    const { onCommit, controls } = inlineEditor();
    act(() => void controls().start(selection.element));
    await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
    title.innerHTML = "Typed";
    const data = {
      v: EDITING_PROTOCOL_VERSION,
      event: "text-edit-ended",
      handle: selection.handle,
      html,
      previous,
    };
    act(() => void ports[0]!.onmessage?.(new MessageEvent("message", { data })));
    await vi.waitFor(() => expect(title.innerHTML).toBe(ORIGINAL));
    expect(onCommit).not.toHaveBeenCalled();
    expect(controls().session).toBeNull();
    act(unmounts.pop()!);
  }
});

it("refuses a frame's end reply carrying anything but text markup, and puts the original back", async () => {
  for (const html of HOSTILE) {
    document.body.innerHTML = `<h1 id="title">${ORIGINAL}</h1><p id="other">x</p>`;
    const title = document.getElementById("title")!;
    const { iframe } = sealedFrame({ wrapHandedOverPort: rewritingTextReplies(html) });
    const selection = await select(iframe, "title");
    const { onCommit, controls } = inlineEditor();
    act(() => void controls().start(selection.element));
    await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
    title.innerHTML = "Hi <b>there</b>";
    act(() => controls().commit());
    await vi.waitFor(() => expect(title.innerHTML).toBe(ORIGINAL));
    expect(onCommit).not.toHaveBeenCalled();
    act(unmounts.pop()!);
  }
});

function textCommits(
  iframe: HTMLIFrameElement,
  current: DomEditSelection | null,
  persist: PersistDomEditOperations,
  lookups: Array<{ entered: () => void; wait: Promise<void> }> = [],
  reloadPreview = vi.fn(),
) {
  let commits!: ReturnType<typeof useDomEditTextCommits>;
  mount(() => {
    commits = useDomEditTextCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      reloadPreview,
      domEditSelection: current,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: async (target, options) => {
        const gate = lookups.shift();
        gate?.entered();
        await gate?.wait;
        return resolveFoundSelection(iframe, target, { ...OPTIONS, ...options });
      },
      persistDomEditOperations: persist,
      resolveImportedFontAsset: () => null,
      readOnlyPreview: false,
    });
  });
  return (element: HTMLElement, html: string) =>
    act(() => commits.handleDomRichTextCommit({ element, html, previousHtml: ORIGINAL }));
}

/** What the file ends up holding: a write the commit pipeline still wants, in order. */
function fileWrites() {
  const saved: string[] = [];
  const persist = vi.fn<PersistDomEditOperations>(async (selection, operations, options) => {
    if (options?.shouldSave?.() === false) return;
    saved.push(`${selection.id}=${String(operations[0]!.value)}`);
  });
  return { saved, persist };
}

/** The composition's file, written through the server's own patcher; `fails` refuses a write by its value. */
function sourceFile(fails: (value: string) => boolean = () => false, markup = ORIGINAL) {
  let file = `<h1 id="title">${markup}</h1><p id="other">x</p>`;
  const persist = vi.fn<PersistDomEditOperations>(async (selection, operations, options) => {
    if (options?.shouldSave?.() === false) return;
    if (fails(String(operations[0]!.value))) throw new Error("disk full");
    file = patchElementInHtml(file, { id: selection.id }, operations).html;
  });
  const text = (id: string) => {
    const element = new DOMParser().parseFromString(file, "text/html").getElementById(id)!;
    return element.innerHTML.replace(/ data-hf-[a-z-]+="[^"]*"/g, "");
  };
  return { persist, text };
}

/** A target lookup the test holds; `reached` once the commit is waiting on it. */
function held() {
  let release!: () => void;
  let entered!: () => void;
  const reached = new Promise<void>((resolve) => (entered = resolve));
  const lookup = { entered, wait: new Promise<void>((resolve) => (release = resolve)) };
  return { lookup, reached, release };
}

/** The inline editor wired to the real commit pipeline, as the canvas wires them. */
function wiredEditor(
  iframe: HTMLIFrameElement,
  selection: DomEditSelection,
  persist: PersistDomEditOperations,
  lookups: Array<{ entered: () => void; wait: Promise<void> }> = [],
) {
  let controls!: ReturnType<typeof useInlineTextEdit>;
  let commits!: ReturnType<typeof useDomEditTextCommits>;
  const reloads = vi.fn();
  mount(() => {
    commits = useDomEditTextCommits({
      activeCompPath: PATH,
      previewIframeRef: { current: iframe },
      showToast: vi.fn(),
      reloadPreview: reloads,
      domEditSelection: selection,
      applyDomSelection: vi.fn(),
      refreshDomEditSelectionFromPreview: vi.fn(),
      buildDomSelectionFromTarget: async (target, options) => {
        const gate = lookups.shift();
        gate?.entered();
        await gate?.wait;
        return resolveFoundSelection(iframe, target, { ...OPTIONS, ...options });
      },
      persistDomEditOperations: persist,
      resolveImportedFontAsset: () => null,
      readOnlyPreview: false,
    });
    controls = useInlineTextEdit({ onCommit: commits.handleDomRichTextCommit });
  });
  return { controls: () => controls, commits: () => commits, reloads };
}

/** A sealed heading whose frame answers `end` only when the test lets it. */
/** `action` picks which text-edit replies the hold catches. */
async function sealedTitleHoldingEnds(markup = ORIGINAL, action: "end" | "start" = "end") {
  let holding: MessageEvent[] | null = null;
  const ends = new Set<unknown>();
  let deliver: (event: MessageEvent) => void = () => {};
  const title = (await sealedTitle(
    [],
    (port) => {
      const send = port.postMessage.bind(port);
      port.postMessage = (data: unknown) => {
        const message = data as { id?: unknown; kind?: string; params?: { action?: string } };
        if (message.kind === "text-edit" && message.params?.action === action) ends.add(message.id);
        send(data);
      };
      const accessor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(port), "onmessage")!;
      Object.defineProperty(port, "onmessage", {
        set(handler: (event: MessageEvent) => void) {
          deliver = handler;
          accessor.set!.call(port, (event: MessageEvent) => {
            const held = holding && ends.has((event.data as { id?: unknown })?.id);
            return held ? holding!.push(event) : handler(event);
          });
        },
      });
      return port;
    },
    markup,
  )) as Awaited<ReturnType<typeof sealedTitle>>;
  const holdEndReplies = () => {
    holding = [];
    const release = (newestFirst = false) => {
      const events = holding ?? [];
      holding = null;
      (newestFirst ? events.reverse() : events).forEach((event) => deliver(event));
    };
    return Object.assign(release, { held: () => holding?.length ?? 0 });
  };
  return { ...title, holdEndReplies };
}

const enter = (el: HTMLElement) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

it("saves a newer blur-ended edit last when the older edit's end reply comes late", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds();
  const { saved, persist } = fileWrites();
  const { controls } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "First";
  const release = holdEndReplies();
  act(() => controls().commit());
  act(() => void controls().start(selection.element));
  release();
  await vi.waitFor(() => expect(saved).toContain("title=First"));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Second";
  title.dispatchEvent(new FocusEvent("blur"));
  await vi.waitFor(() => expect(saved).toContain("title=Second"));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(saved).toEqual(["title=First", "title=Second"]);
});

it("keeps a Design panel save made while an older inline save was still looking up its target", async () => {
  const { iframe } = await sealedTitle();
  const plain = await select(iframe, "other");
  const { saved, persist } = fileWrites();
  const first = held();
  const { commits } = wiredEditor(iframe, plain, persist, [first.lookup]);
  const older = act(() =>
    commits().handleDomRichTextCommit({ element: plain.element, html: "First", previousHtml: "x" }),
  );
  await first.reached;
  await act(() => commits().handleDomTextCommitForSelection(plain, "Newer"));
  expect(saved).toEqual(["other=Newer"]);
  first.release();
  await older;
  expect(saved.at(-1)).toBe("other=Newer");
});

it("saves an open inline draft before a Design panel save made while it was open", async () => {
  const { iframe } = await sealedTitle();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  const { saved, persist } = fileWrites();
  const { controls, commits } = wiredEditor(iframe, plain, persist);
  act(() => void controls().start(plain.element));
  await vi.waitFor(() => expect(shown.getAttribute("contenteditable")).toBe("true"));
  shown.innerHTML = "Inline";
  await act(() => commits().handleDomTextCommitForSelection(plain, "Panel"));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(saved).toEqual(["other=Inline", "other=Panel"]);
});

it("lands the newer of two saves of a heading last when the older write is slow", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const landed: string[] = [];
  let finishOlder!: () => void;
  const persist = vi.fn<PersistDomEditOperations>(async (_, operations, options) => {
    if (options?.shouldSave?.() === false) return;
    const value = String(operations[0]!.value);
    if (value === "Older") await new Promise<void>((resolve) => (finishOlder = resolve));
    landed.push(value);
  });
  const { commits } = wiredEditor(iframe, selection, persist);
  // Not in act: the newer commit's scope would still be open when the older one's closes.
  const commit = (html: string, previousHtml: string) =>
    commits().handleDomRichTextCommit({ element: selection.element, html, previousHtml });
  const older = commit("Older", ORIGINAL);
  await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  const newer = commit("Newer", "Older");
  await vi.waitFor(() => expect(title.innerHTML).toBe("Newer"));
  finishOlder();
  await older;
  await newer;
  expect(landed).toEqual(["Older", "Newer"]);
});

it("leaves another writer's text on the canvas when a later save fails after it", async () => {
  const { title, iframe, selection } = await sealedTitle();
  let fail!: (error: Error) => void;
  const persist = vi
    .fn<PersistDomEditOperations>()
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
  const { commits } = wiredEditor(iframe, selection, persist);
  await act(() =>
    commits().handleDomRichTextCommit({
      element: selection.element,
      html: "First",
      previousHtml: ORIGINAL,
    }),
  );
  await settled(iframe, selection);
  const later = act(() =>
    commits().handleDomRichTextCommit({
      element: selection.element,
      html: "Second",
      previousHtml: "First",
    }),
  );
  await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
  await settled(iframe, selection);
  title.innerHTML = "Undone";
  requestPreviewReload();
  previewReloadBegun();
  fail(new Error("disk full"));
  await later;
  await settled(iframe, selection);
  await nextTask();
  expect(title.innerHTML).toBe("Undone");
});

it("keeps the last saved text on the canvas when an Enter-submitted draft fails after a refused redraw", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const persist = vi
    .fn<PersistDomEditOperations>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("disk full"));
  const first = held();
  const { controls, commits } = wiredEditor(iframe, selection, persist, [first.lookup]);
  const saving = act(() =>
    commits().handleDomRichTextCommit({
      element: selection.element,
      html: "First",
      previousHtml: ORIGINAL,
    }),
  );
  await first.reached;
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  first.release();
  await saving;
  title.innerHTML = "Second";
  enter(title);
  await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
  await settled(iframe, selection);
  await nextTask();
  await settled(iframe, selection);
  expect(title.innerHTML).toBe("First");
});

/** A sealed frame whose messages to Studio (by default its `text-edit-ended` notices) wait until the test lets them. */
async function sealedFrameHoldingEndedNotices() {
  let holding: MessageEvent[] | null = null;
  let held: (data: unknown) => boolean = () => false;
  let deliver: (event: MessageEvent) => void = () => {};
  const frame = await sealedTitle([], (port) => {
    const accessor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(port), "onmessage")!;
    Object.defineProperty(port, "onmessage", {
      set(handler: (event: MessageEvent) => void) {
        deliver = handler;
        accessor.set!.call(port, (event: MessageEvent) => {
          return holding && held(event.data) ? holding.push(event) : handler(event);
        });
      },
    });
    return port;
  });
  const isNotice = (data: unknown) => (data as { event?: unknown })?.event === "text-edit-ended";
  const holdEndedNotices = (which: (data: unknown) => boolean = isNotice) => {
    held = which;
    holding = [];
    return () => {
      const events = holding ?? [];
      holding = null;
      events.forEach((event) => deliver(event));
    };
  };
  return { ...frame, holdEndedNotices };
}

it("saves a Design panel edit last when an older blur's notice reaches Studio after it", async () => {
  const { iframe, holdEndedNotices } = await sealedFrameHoldingEndedNotices();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  const { saved, persist } = fileWrites();
  const { controls, commits } = wiredEditor(iframe, plain, persist);
  act(() => void controls().start(plain.element));
  await vi.waitFor(() => expect(shown.getAttribute("contenteditable")).toBe("true"));
  shown.innerHTML = "Blur";
  const release = holdEndedNotices();
  shown.dispatchEvent(new FocusEvent("blur"));
  await settled(iframe, plain);
  const panel = commits().handleDomTextCommitForSelection(plain, "Panel");
  await nextTask();
  release();
  await act(() => panel);
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(saved.at(-1)).toBe("other=Panel");
});

it("keeps a Design panel save on the canvas when a later inline draft is cancelled", async () => {
  const { iframe } = await sealedTitle();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  const { saved, persist } = fileWrites();
  const { controls, commits } = wiredEditor(iframe, plain, persist);
  await act(() =>
    commits().handleDomRichTextCommit({
      element: plain.element,
      html: "Inline",
      previousHtml: "x",
    }),
  );
  await act(() => commits().handleDomTextCommitForSelection(plain, "Panel"));
  await settled(iframe, plain);
  expect([saved.at(-1), shown.innerHTML]).toEqual(["other=Panel", "Panel"]);
  act(() => void controls().start(plain.element));
  await vi.waitFor(() => expect(shown.getAttribute("contenteditable")).toBe("true"));
  shown.innerHTML = "Draft";
  act(() => controls().cancel());
  await settled(iframe, plain);
  await nextTask();
  await settled(iframe, plain);
  expect(shown.innerHTML).toBe("Panel");
});

it("rolls a failed save after an outside change and reload back to the file, not to an older save", async () => {
  const { iframe, reload } = await sealedTitle();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  const { saved, persist: write } = fileWrites();
  const persist = vi.fn<PersistDomEditOperations>(async (target, operations, options) => {
    if (String(operations[0]!.value) === "Draft") throw new Error("disk full");
    return write(target, operations, options);
  });
  const { commits, reloads } = wiredEditor(iframe, plain, persist);
  await act(() =>
    commits().handleDomRichTextCommit({
      element: plain.element,
      html: "Inline",
      previousHtml: "x",
    }),
  );
  await settled(iframe, plain);
  expect([saved.at(-1), shown.innerHTML]).toEqual(["other=Inline", "Inline"]);

  shown.innerHTML = "Agent";
  requestPreviewReload();
  reload();
  previewReloadBegun();
  const again = await select(iframe, "other");
  await act(() =>
    commits().handleDomRichTextCommit({
      element: again.element,
      html: "Draft",
      previousHtml: "Agent",
    }),
  );
  await vi.waitFor(() => expect(reloads).toHaveBeenCalledTimes(1));
  await settled(iframe, again);
  expect(shown.innerHTML).not.toBe("Inline");
});

it("rolls a failed save back to the file's text, not to an older save that was skipped", async () => {
  const { iframe } = await sealedTitle();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  let releaseFirst!: () => void;
  const written: string[] = [];
  const persist = vi.fn<PersistDomEditOperations>(async (_, operations, options) => {
    const value = String(operations[0]!.value);
    if (value === "First") await new Promise<void>((resolve) => (releaseFirst = resolve));
    if (options?.shouldSave?.() === false) return;
    if (value === "Second") throw new Error("disk full");
    written.push(value);
  });
  const { commits, reloads } = wiredEditor(iframe, plain, persist);
  const commit = (html: string, previousHtml: string) =>
    commits().handleDomRichTextCommit({ element: plain.element, html, previousHtml });
  const first = commit("First", "x");
  await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  const second = commit("Second", "First");
  await vi.waitFor(() => expect(shown.innerHTML).toBe("Second"));
  releaseFirst();
  await act(() => Promise.all([first, second]));
  await vi.waitFor(() => expect(reloads).toHaveBeenCalledTimes(1));
  expect(written).toEqual([]);
  expect(shown.innerHTML).not.toBe("First");
});

it("retires an inline edit whose frame was replaced while its end was pending, so its late notice saves nothing", async () => {
  const { iframe, reload, holdEndedNotices } = await sealedFrameHoldingEndedNotices();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  const { saved, persist } = fileWrites();
  const { controls, commits } = wiredEditor(iframe, plain, persist);
  act(() => void controls().start(plain.element));
  await vi.waitFor(() => expect(shown.getAttribute("contenteditable")).toBe("true"));
  shown.innerHTML = "Blur";
  const release = holdEndedNotices(() => true);
  shown.dispatchEvent(new FocusEvent("blur"));
  const panel = commits().handleDomTextCommitForSelection(plain, "Panel");
  await nextTask();
  reload();
  await act(() => panel);
  release();
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  await nextTask();
  expect(saved).not.toContain("other=Blur");
  expect(saved.at(-1)).toBe("other=Panel");
});

it("keeps nothing to roll back to from a save that completes after the preview reloaded", async () => {
  const { iframe, reload } = await sealedTitle();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  let finish!: () => void;
  const persist = vi.fn<PersistDomEditOperations>(async (_, operations, options) => {
    if (String(operations[0]!.value) === "Draft") throw new Error("disk full");
    await new Promise<void>((resolve) => (finish = resolve));
    options?.shouldSave?.();
  });
  const { commits, reloads } = wiredEditor(iframe, plain, persist);
  const saving = commits().handleDomRichTextCommit({
    element: plain.element,
    html: "Inline",
    previousHtml: "x",
  });
  await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
  shown.innerHTML = "Agent";
  requestPreviewReload();
  reload();
  previewReloadBegun();
  finish();
  await act(() => saving);
  const again = await select(iframe, "other");
  await act(() =>
    commits().handleDomRichTextCommit({
      element: again.element,
      html: "Draft",
      previousHtml: "Agent",
    }),
  );
  await vi.waitFor(() => expect(reloads).toHaveBeenCalledTimes(1));
  await settled(iframe, again);
  expect(shown.innerHTML).not.toBe("Inline");
});

it("saves another heading's open draft before the reload a failed first save asks for", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const plain = await select(iframe, "other");
  const { saved, persist: write } = fileWrites();
  const persist = vi.fn<PersistDomEditOperations>(async (target, operations, options) => {
    if (target.id === "other") throw new Error("disk full");
    return write(target, operations, options);
  });
  const { controls, commits, reloads } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "B draft";
  await act(() =>
    commits().handleDomRichTextCommit({ element: plain.element, html: "A", previousHtml: "x" }),
  );
  await vi.waitFor(() => expect(reloads).toHaveBeenCalledTimes(1));
  expect(saved).toContain("title=B draft");
});

it("asks for no reload when the text's element is gone from the preview", async () => {
  const { iframe } = await sealedTitle();
  const plain = await select(iframe, "other");
  const { persist } = fileWrites();
  const { commits, reloads } = wiredEditor(iframe, plain, persist);
  document.getElementById("other")!.remove();
  await act(() =>
    commits().handleDomRichTextCommit({ element: plain.element, html: "A", previousHtml: "x" }),
  );
  await nextTask();
  expect([persist.mock.calls.length, reloads.mock.calls.length]).toEqual([0, 0]);
});

it("shows the newer of two saves whose redraws were refused once the open edit is cancelled", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const { persist } = fileWrites();
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  for (const html of ["First", "Second"])
    await act(() =>
      commits().handleDomRichTextCommit({
        element: selection.element,
        html,
        previousHtml: ORIGINAL,
      }),
    );
  await settled(iframe, selection);
  act(() => controls().cancel());
  await settled(iframe, selection);
  await nextTask();
  await settled(iframe, selection);
  expect(title.innerHTML).toBe("Second");
});

it("drops an older save of a heading that resumes after a newer save of it", async () => {
  const { iframe, selection } = await sealedTitle();
  const { saved, persist } = fileWrites();
  const first = held();
  const commit = textCommits(iframe, selection, persist, [first.lookup]);
  const older = commit(selection.element, "First");
  await first.reached;
  await commit(selection.element, "Second");
  first.release();
  await older;
  expect(saved).toEqual(["title=Second"]);
});

it("saves both headings when one heading's lookup is slow and the other saves first", async () => {
  const { iframe, selection } = await sealedTitle();
  const other = await select(iframe, "other");
  const { saved, persist } = fileWrites();
  const first = held();
  const commit = textCommits(iframe, selection, persist, [first.lookup]);
  const slow = commit(selection.element, "First");
  await first.reached;
  await commit(other.element, "Other");
  first.release();
  await slow;
  expect(saved.sort()).toEqual(["other=Other", "title=First"]);
});

it("keeps the newer save of a heading across a frame reload", async () => {
  const { iframe, reload, selection } = await sealedTitle();
  const { saved, persist } = fileWrites();
  const first = held();
  const commit = textCommits(iframe, selection, persist, [first.lookup]);
  const older = commit(selection.element, "First");
  await first.reached;
  reload();
  const again = await select(iframe, "title");
  expect(again.element).not.toBe(selection.element);
  await commit(again.element, "Second");
  first.release();
  await older;
  expect(saved).toEqual(["title=Second"]);
});

it("shows a save whose redraw the frame refused once the newer edit open on it is cancelled", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const { controls } = inlineEditor();
  const { persist } = fileWrites();
  const first = held();
  const commit = textCommits(iframe, selection, persist, [first.lookup]);
  const saving = commit(selection.element, "First");
  await first.reached;
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.hasAttribute("contenteditable")).toBe(true));
  first.release();
  await saving;
  await settled(iframe, selection);
  expect(title.innerHTML).toBe(ORIGINAL);
  act(() => controls().cancel());
  await vi.waitFor(() => expect(title.innerHTML).toBe("First"));
  act(unmounts.pop()!);
});

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
      layout: { width, height: 40 },
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

it("saves a sealed rich text commit and draws the file again when its first save fails", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const persist = vi.fn<PersistDomEditOperations>(async () => {
    throw new Error("disk full");
  });
  const reloadPreview = vi.fn();
  title.innerHTML = "Typed";
  await textCommits(iframe, selection, persist, [], reloadPreview)(selection.element, "Typed");
  expect(persist).toHaveBeenCalledOnce();
  expect(persist.mock.calls[0]![1]).toEqual([expect.objectContaining({ type: "rich-text" })]);
  await vi.waitFor(() => expect(reloadPreview).toHaveBeenCalledTimes(1));
});

it("shows the saved text when the frame put the original back before the save, as on a removed and re-added node", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
  expect(title.innerHTML).toBe(ORIGINAL);
  await textCommits(iframe, selection, persist)(selection.element, "Typed");
  expect(persist).toHaveBeenCalledOnce();
  await settled(iframe, selection);
  expect(title.innerHTML).toBe("Typed");
});

it("leaves the frame alone when it already shows something other than the original", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const persist = vi.fn<PersistDomEditOperations>(async () => undefined);
  title.innerHTML = "Newer";
  await textCommits(iframe, selection, persist)(selection.element, "Typed");
  await settled(iframe, selection);
  expect(title.innerHTML).toBe("Newer");
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

/** Answered after every request sent before it: the frame's port is one ordered queue. */
const settled = (iframe: HTMLIFrameElement, selection: DomEditSelection) =>
  describePreviewElements(iframe, [selection.handle!]);

it("a failed save leaves a newer draft open on the same element alone", async () => {
  const { title, iframe, selection } = await sealedTitle();
  let fail!: (error: Error) => void;
  const persist = vi.fn<PersistDomEditOperations>(
    () => new Promise((_, reject) => (fail = reject)),
  );
  title.innerHTML = "First";
  const first = textCommits(iframe, selection, persist)(selection.element, "First");
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
  const handle = selection.handle!;
  await previewTextEdit(iframe, { handle, action: "start", caret: null });
  expect(title.getAttribute("contenteditable")).toBe("true");
  title.innerHTML = "Second draft";
  fail(new Error("disk full"));
  await first;
  await settled(iframe, selection);
  expect(title.innerHTML).toBe("Second draft");
});

it("saves once an edit the frame ended on blur just before the editor unmounted", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const onCommit = vi.fn<(commit: InlineTextEditCommit) => void>();
  const root = createRoot(document.createElement("div"));
  let controls!: ReturnType<typeof useInlineTextEdit>;
  act(() =>
    root.render(
      createElement(() => {
        controls = useInlineTextEdit({ onCommit });
        return null;
      }),
    ),
  );
  act(() => void controls.start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Typed";
  act(() => {
    title.dispatchEvent(new FocusEvent("blur"));
    root.unmount();
  });
  const typed = { element: selection.element, html: "Typed", previousHtml: ORIGINAL };
  await vi.waitFor(() => expect(onCommit).toHaveBeenCalledWith(typed));
  await settled(iframe, selection);
  expect(onCommit).toHaveBeenCalledOnce();
});

it("opens no sealed text edit on a layer the frame would refuse, so Enter stays playback's", async () => {
  document.body.innerHTML = `<section id="s"><div>One</div><div>Two</div></section><p id="p">x</p>`;
  const { iframe } = sealedFrame();
  expect(canEditSealedTextInline(await select(iframe, "s"))).toBe(false);
  expect(canEditSealedTextInline(await select(iframe, "p"))).toBe(true);
});

// fails without the fix: a sealed empty box opened a text edit, so the press that dragged it after its select click
// was taken as a double press and the drag moved nothing (edit bench seqab-none-px-r0-nested-z100).
it("opens no sealed text edit on a box with no text, as a regular preview opens none", async () => {
  document.body.innerHTML = `<div id="box"></div><div id="blank"> </div><p id="p">x</p>`;
  const { iframe } = sealedFrame();
  for (const id of ["box", "blank"]) {
    expect(canEditElementTextInline(document.getElementById(id))).toBe(false);
    expect(canEditSealedTextInline(await select(iframe, id))).toBe(false);
  }
  expect(canEditSealedTextInline(await select(iframe, "p"))).toBe(true);
});

it("holds the pending-edit drain until a save the frame started on blur lands", async () => {
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  const { title, selection } = await sealedTitle();
  let land!: () => void;
  const onCommit = vi.fn(() => new Promise<void>((resolve) => (land = resolve)));
  let controls!: ReturnType<typeof useInlineTextEdit>;
  mount(() => {
    controls = useInlineTextEdit({ onCommit });
  });
  act(() => void controls.start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Typed";
  act(() => void title.dispatchEvent(new FocusEvent("blur")));
  await vi.waitFor(() => expect(onCommit).toHaveBeenCalledOnce());
  expect(hasStudioPendingEdits()).toBe(true);
  land();
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
});

it("leaves Enter to playback on text too long for the frame to edit", async () => {
  const long = "x".repeat(200_001);
  document.body.innerHTML = `<p id="long">${long}</p><p id="short">${long.slice(1)}</p>`;
  const { iframe } = sealedFrame();
  expect(canEditSealedTextInline(await select(iframe, "long"))).toBe(false);
  expect(canEditSealedTextInline(await select(iframe, "short"))).toBe(true);
});

it("keeps the inline text its handoff saved when a field added from the panel follows it", async () => {
  const { title, iframe, selection } = await sealedTitle([], undefined, SPANS);
  const { persist, text } = sourceFile(undefined, SPANS);
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.querySelector("span")!.textContent = "Uno";
  await act(() => commits().handleDomAddTextField(selection.textFields.at(-1)!.key));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(text("title")).toMatch(
    /^<span>Uno<\/span> <span>Two<\/span><span style="[^"]*">New text<\/span>$/,
  );
});

it("keeps the inline text its handoff saved when the panel then edits another field", async () => {
  const { title, iframe, selection } = await sealedTitle([], undefined, SPANS);
  const { persist, text } = sourceFile(undefined, SPANS);
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.querySelector("span")!.textContent = "Uno";
  const second = selection.textFields[1]!.key;
  await act(() => commits().handleDomTextCommitForSelection(selection, "Dos", second));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(text("title")).toBe("<span>Uno</span> <span>Dos</span>");
});

it("saves the draft before both panel saves when its end reply is late and the newer panel save fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { iframe, holdEndReplies } = await sealedTitleHoldingEnds();
  const plain = await select(iframe, "other");
  const shown = document.getElementById("other")!;
  const { persist, text } = sourceFile((value) => value === "Second");
  const { controls, commits } = wiredEditor(iframe, plain, persist);
  act(() => void controls().start(plain.element));
  await vi.waitFor(() => expect(shown.getAttribute("contenteditable")).toBe("true"));
  shown.innerHTML = "Draft";
  const release = holdEndReplies();
  const saves: Array<Promise<unknown>> = [];
  act(() => void saves.push(commits().handleDomTextCommitForSelection(plain, "First")));
  act(() => void saves.push(commits().handleDomTextCommitForSelection(plain, "Second")));
  release();
  await act(() => Promise.allSettled(saves));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(persist.mock.calls.map(([, operations]) => String(operations[0]!.value))).toEqual([
    "Draft",
    "First",
    "Second",
  ]);
  expect(text("other")).toBe("Draft");
});

it("redraws the last saved text when a newer draft is cancelled before that save's write completes", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const { controls } = inlineEditor();
  let finish!: () => void;
  const persist = vi.fn<PersistDomEditOperations>(
    () => new Promise<void>((resolve) => (finish = resolve)),
  );
  const first = held();
  const saving = textCommits(iframe, selection, persist, [first.lookup])(
    selection.element,
    "First",
  );
  await first.reached;
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.hasAttribute("contenteditable")).toBe(true));
  first.release();
  await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
  await settled(iframe, selection);
  expect(title.innerHTML).toBe(ORIGINAL);
  act(() => controls().cancel());
  await settled(iframe, selection);
  finish();
  await saving;
  await settled(iframe, selection);
  await vi.waitFor(() => expect(title.innerHTML).toBe("First"));
  act(unmounts.pop()!);
});

/** Acts as a person does once the caret shows: at once if it already does, else after `wait` lets the edit open. */
async function whenCaretShows(
  title: HTMLElement,
  action: () => void,
  wait: () => Promise<unknown>,
) {
  await nextTask();
  const shown = title.isContentEditable;
  if (shown) action();
  await wait();
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  if (!shown) action();
}

it("lands a draft and the panel save that ended it before a new edit on the element saves", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds(SPANS);
  const { persist, text } = sourceFile(undefined, SPANS);
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.querySelectorAll("span")[1]!.textContent = "Dos";
  const release = holdEndReplies();
  const second = selection.textFields[1]!.key;
  let panel!: Promise<unknown>;
  act(() => void (panel = commits().handleDomTextCommitForSelection(selection, "Blue", second)));
  act(() => void controls().start(selection.element));
  const typeAndSave = () => {
    title.querySelector("span")!.textContent = "Tres";
    act(() => controls().commit());
  };
  await whenCaretShows(title, typeAndSave, () => (release(), act(() => panel)));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(text("title")).toBe("<span>Tres</span> <span>Blue</span>");
});

it("saves a queued panel change without the draft of an edit opened after it", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds(SPANS);
  const { persist, text } = sourceFile(undefined, SPANS);
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.querySelector("span")!.textContent = "Uno";
  const release = holdEndReplies();
  let removing!: Promise<unknown>;
  act(() => void (removing = commits().handleDomRemoveTextField(selection.textFields[1]!.key)));
  act(() => void controls().start(selection.element));
  const type = () => void (title.querySelector("span")!.textContent = "Dos");
  await whenCaretShows(title, type, () => (release(), act(() => removing)));
  act(() => controls().cancel());
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(text("title")).toBe("<span>Uno</span>");
});

// fails without the fix: a sealed text edit began no gesture, so a preview reload ran over it and dropped the draft.
it("holds a preview reload while a sealed text edit is open and runs it once the edit ends", async () => {
  const { iframe, selection } = await sealedTitle();
  const { controls } = inlineEditor();
  act(() => void controls().start(selection.element));
  const doc = gestureDocumentOf(iframe)!;
  const reload = vi.fn();
  afterStudioManualEditGestures(doc, reload);
  expect(isStudioManualEditGestureLiveIn(doc)).toBe(true);
  act(() => controls().cancel());
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(isStudioManualEditGestureLiveIn(doc)).toBe(false);
});

it("keeps a reload held until the sealed end's reply lands, so the draft is saved first", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds();
  const { saved, persist } = fileWrites();
  const { controls } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Draft";
  let savedAtReload: string[] | null = null;
  const reload = vi.fn(() => void (savedAtReload = [...saved]));
  afterStudioManualEditGestures(gestureDocumentOf(iframe)!, reload);
  const release = holdEndReplies();
  act(() => controls().commit());
  await nextTask();
  expect(reload).not.toHaveBeenCalled();
  release();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(savedAtReload).toEqual(["title=Draft"]);
});

it("lets a held reload go and reports when the sealed end never answers", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds();
  const onLost = vi.fn<(reason: string) => void>();
  let controls!: ReturnType<typeof useInlineTextEdit>;
  mount(() => {
    controls = useInlineTextEdit({ onCommit: vi.fn(), onLost });
  });
  act(() => void controls.start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Draft";
  const reload = vi.fn();
  afterStudioManualEditGestures(gestureDocumentOf(iframe)!, reload);
  holdEndReplies();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => controls.commit());
    await vi.advanceTimersByTimeAsync(EDITING_REQUEST_TIMEOUT_MS);
  } finally {
    vi.useRealTimers();
  }
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(onLost).toHaveBeenCalledOnce();
});

it("keeps a reload held until the save of an edit the frame ended on blur has read the frame", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const { saved, persist } = fileWrites();
  const lookup = held();
  const { controls } = wiredEditor(iframe, selection, persist, [lookup.lookup]);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Draft";
  let savedAtReload: string[] | null = null;
  const reload = vi.fn(() => void (savedAtReload = [...saved]));
  afterStudioManualEditGestures(gestureDocumentOf(iframe)!, reload);
  title.dispatchEvent(new FocusEvent("blur"));
  await lookup.reached;
  expect(reload).not.toHaveBeenCalled();
  lookup.release();
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(savedAtReload).toEqual(["title=Draft"]);
});

// fails without the fix: a start reply that missed its deadline closed the edit under the person's typing.
it("keeps a sealed edit open when its start reply misses the deadline, and saves all of it at the end", async () => {
  const {
    title,
    iframe,
    selection,
    holdEndReplies: holdStartReplies,
  } = await sealedTitleHoldingEnds(ORIGINAL, "start");
  const { saved, persist } = fileWrites();
  const { controls } = wiredEditor(iframe, selection, persist);
  holdStartReplies();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => void controls().start(selection.element));
    await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
    title.innerHTML = "Dr";
    await vi.advanceTimersByTimeAsync(EDITING_REQUEST_TIMEOUT_MS);
  } finally {
    vi.useRealTimers();
  }
  await settled(iframe, selection);
  expect([controls().session !== null, title.getAttribute("contenteditable")]).toEqual([
    true,
    "true",
  ]);
  title.innerHTML = "Draft";
  act(() => controls().commit());
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(saved).toEqual(["title=Draft"]);
});

// fails without the fix: the newer save on field 1 superseded the older one on field 0, so Blue never landed.
it("keeps both panel saves on different fields of one element when they queue behind an edit", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds(SPANS);
  const { persist, text } = sourceFile(undefined, SPANS);
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  const release = holdEndReplies();
  const [first, second] = selection.textFields.map((field) => field.key);
  const saves: Array<Promise<unknown>> = [];
  act(() => void saves.push(commits().handleDomTextCommitForSelection(selection, "Blue", first)));
  act(() => void saves.push(commits().handleDomTextCommitForSelection(selection, "Red", second)));
  release();
  await act(() => Promise.allSettled(saves));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(text("title")).toBe("<span>Blue</span> <span>Red</span>");
});

// fails without the fix: the remove waited on the edit's late end, a newer save claimed first, and it was dropped.
it("keeps a panel remove that ended an edit when a newer save on another field claims first", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds(SPANS);
  const { persist, text } = sourceFile(undefined, SPANS);
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  const release = holdEndReplies();
  const [first, second] = selection.textFields.map((field) => field.key);
  const saves: Array<Promise<unknown>> = [];
  act(() => void saves.push(commits().handleDomRemoveTextField(second!)));
  await vi.waitFor(() => expect(controls().session).toBeNull());
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(controls().session).not.toBeNull());
  act(() => controls().commit());
  act(() => void saves.push(commits().handleDomTextCommitForSelection(selection, "Blue", first)));
  await vi.waitFor(() => expect(release.held()).toBe(2));
  release(true);
  await act(() => Promise.allSettled(saves));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(text("title")).toBe("<span>Blue</span>");
});

it("keeps a panel remove that ended an edit when a newer save on the same field claims first", async () => {
  const { title, iframe, selection, holdEndReplies } = await sealedTitleHoldingEnds(SPANS);
  const { persist, text } = sourceFile(undefined, SPANS);
  const { controls, commits } = wiredEditor(iframe, selection, persist);
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  const release = holdEndReplies();
  const [, second] = selection.textFields.map((field) => field.key);
  const saves: Array<Promise<unknown>> = [];
  act(() => void saves.push(commits().handleDomRemoveTextField(second!)));
  await vi.waitFor(() => expect(controls().session).toBeNull());
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(controls().session).not.toBeNull());
  act(() => controls().commit());
  act(() => void saves.push(commits().handleDomTextCommitForSelection(selection, "Red", second)));
  await vi.waitFor(() => expect(release.held()).toBe(2));
  release(true);
  await act(() => Promise.allSettled(saves));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  // In gesture order the save targets a field the remove already took out.
  expect(text("title")).toBe("<span>One</span>");
});

// fails without the fix: the failed add was not the newest save, so its field stayed drawn though no file had it.
it("takes back a failed field add's draw when a newer save on another field lands", async () => {
  const { title, iframe, selection } = await sealedTitleHoldingEnds(SPANS);
  let failAdd!: () => void;
  const addFails = new Promise<void>((resolve) => (failAdd = resolve));
  const { persist: write, text } = sourceFile((value) => value.includes("New text"), SPANS);
  const persist: typeof write = async (...args) => {
    if (String(args[1][0]!.value).includes("New text")) await addFails;
    return write(...args);
  };
  const { commits } = wiredEditor(iframe, selection, persist);
  const saves: Array<Promise<unknown>> = [];
  act(() => void saves.push(commits().handleDomAddTextField(selection.textFields[1]!.key)));
  await vi.waitFor(() => expect(title.textContent).toContain("New text"));
  // The person picks the field from the panel as the canvas now shows it.
  const shown = await select(iframe, "title");
  act(
    () =>
      void saves.push(
        commits().handleDomTextCommitForSelection(shown, "Blue", shown.textFields[0]!.key),
      ),
  );
  failAdd();
  await act(() => Promise.allSettled(saves));
  await vi.waitFor(() => expect(hasStudioPendingEdits()).toBe(false));
  expect(text("title")).toBe("<span>Blue</span> <span>Two</span>");
  await vi.waitFor(() => expect(title.textContent).toBe("Blue Two"));
});

type Edit = ReturnType<typeof inlineEditor> & { title: HTMLElement; reload: () => void };
const ENDS: Array<[string, (edit: Edit) => void]> = [
  ["is saved", (edit) => act(() => edit.controls().commit())],
  ["is cancelled", (edit) => act(() => edit.controls().cancel())],
  ["is ended by the frame on blur", (edit) => edit.title.dispatchEvent(new FocusEvent("blur"))],
  ["unmounts mid-edit", () => act(unmounts.pop()!)],
  ["has its frame reloaded and never ends", (edit) => edit.reload()],
];

// fails without the fix: the reclaim blurred the frame Studio had just focused for the edit.
describe.each(ENDS)("a sealed text edit that %s", (_, end) => {
  it("keeps the keyboard in the frame while open and hands it back to Studio", async () => {
    const { title, iframe, selection, reload } = await sealedTitle();
    const focus = { inFrame: false };
    iframe.getRootNode = () => ({ activeElement: focus.inFrame ? iframe : document.body }) as never;
    iframe.blur = vi.fn(() => void (focus.inFrame = false));
    onTestFinished(keepKeyboardOutOfSealedFrame(iframe));
    const editor = inlineEditor();
    act(() => void editor.controls().start(selection.element));
    await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
    focus.inFrame = true;
    window.dispatchEvent(new Event("blur"));
    await nextTask();
    expect(focus.inFrame).toBe(true);
    end({ ...editor, title, reload });
    await vi.waitFor(() => expect(focus.inFrame).toBe(false));
  });
});

// fails without the fix: the hold lasted until the frame said its edit ended, so the film took the keyboard back.
it("ends a sealed text edit the frame never ends once Studio takes focus back, and keeps the keyboard", async () => {
  const { title, iframe, selection } = await sealedTitle();
  const focus = { inFrame: false };
  iframe.getRootNode = () => ({ activeElement: focus.inFrame ? iframe : document.body }) as never;
  iframe.blur = vi.fn(() => void (focus.inFrame = false));
  onTestFinished(keepKeyboardOutOfSealedFrame(iframe));
  const { onCommit, controls } = inlineEditor();
  act(() => void controls().start(selection.element));
  await vi.waitFor(() => expect(title.getAttribute("contenteditable")).toBe("true"));
  title.innerHTML = "Typed";
  act(() => void window.dispatchEvent(new FocusEvent("focus")));
  expect(controls().session).toBeNull();
  await vi.waitFor(() =>
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ html: "Typed" })),
  );
  focus.inFrame = true;
  window.dispatchEvent(new Event("blur"));
  await vi.waitFor(() => expect(focus.inFrame).toBe(false));
});
