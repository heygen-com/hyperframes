// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPreviewElementForSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import { retirePreviewEditingClient } from "../player/lib/previewChannel";
import { describePreviewElements } from "../player/lib/previewElements";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import { flushStudioPendingEdits } from "../utils/studioPendingEdits";
import { useInlineTextEdit, type InlineTextEditCommit } from "./useInlineTextEdit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PATH = "index.html";
const OPTIONS = { activeCompositionPath: PATH, isMasterView: false, skipSourceProbe: true };
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.innerHTML = "";
});

const nextTask = () => new Promise((resolve) => setTimeout(resolve));

interface Title {
  target: HTMLElement;
  shown: HTMLElement;
  remove: () => void;
  putBack: () => void;
  silenceEnds?: () => void;
  holdEndReplies?: () => () => void;
  /** Answered once the frame has handled every request sent before it. */
  caughtUp?: () => Promise<unknown>;
  frameReloads?: () => void;
  /** Observers on the live element's document that are still connected. */
  watching?: () => number;
}

function liveTitle(): Title {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  frame.contentDocument!.body.innerHTML = `<h1 id="title">Hello</h1>`;
  const doc = frame.contentDocument!;
  const shown = doc.getElementById("title")!;
  const open = new Set<MutationObserver>();
  const { observe, disconnect } = MutationObserver.prototype;
  const watch = vi
    .spyOn(MutationObserver.prototype, "observe")
    .mockImplementation(function (this: MutationObserver, target, options) {
      if (target === doc) open.add(this);
      return observe.call(this, target, options);
    });
  const unwatch = vi
    .spyOn(MutationObserver.prototype, "disconnect")
    .mockImplementation(function (this: MutationObserver) {
      open.delete(this);
      return disconnect.call(this);
    });
  cleanups.push(() => (watch.mockRestore(), unwatch.mockRestore()));
  return {
    target: shown,
    shown,
    remove: () => shown.remove(),
    putBack: () => doc.body.append(shown),
    watching: () => open.size,
  };
}

async function sealedTitle(): Promise<Title> {
  document.body.innerHTML = `<h1 id="title">Hello</h1>`;
  const shown = document.getElementById("title")!;
  let answersEnd = true;
  let holding: MessageEvent[] | null = null;
  const ends = new Set<unknown>();
  const { iframe } = sealedPreviewFrame({
    wrapHandedOverPort: (port) => {
      const send = port.postMessage.bind(port);
      port.postMessage = (data: unknown) => {
        const message = data as { id?: unknown; kind?: string; params?: { action?: string } };
        const end = message.kind === "text-edit" && message.params?.action === "end";
        if (end) ends.add(message.id);
        if (!answersEnd && end) return;
        send(data);
      };
      const accessor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(port), "onmessage")!;
      Object.defineProperty(port, "onmessage", {
        set(handler: (event: MessageEvent) => void) {
          accessor.set!.call(port, (event: MessageEvent) => {
            const held = holding && ends.has((event.data as { id?: unknown })?.id);
            return held ? holding!.push(event) : handler(event);
          });
        },
      });
      const deliver = (event: MessageEvent) =>
        (accessor.get!.call(port) as (e: MessageEvent) => void)(event);
      releaseHeld = () => {
        const events = holding ?? [];
        holding = null;
        events.forEach(deliver);
      };
      return port;
    },
  });
  let releaseHeld = () => {};
  cleanups.push(() => retirePreviewEditingClient(iframe));
  // This frame shares Studio's document; a real sealed frame's focus is out of Studio's sight.
  const focus = vi.spyOn(document, "activeElement", "get").mockReturnValue(document.body);
  cleanups.push(() => focus.mockRestore());
  const found = await findPreviewElementForSelection(
    iframe,
    { id: "title", sourceFile: PATH },
    PATH,
  );
  const selection = (await resolvePreviewSelection(iframe, found!, OPTIONS))!;
  return {
    target: selection.element,
    shown,
    remove: () => shown.remove(),
    putBack: () => document.body.append(shown),
    silenceEnds: () => (answersEnd = false),
    holdEndReplies: () => {
      holding = [];
      return () => releaseHeld();
    },
    frameReloads: () => iframe.dispatchEvent(new Event("load")),
    caughtUp: () => describePreviewElements(iframe, [selection.handle!]),
  };
}

async function openEdit(mode: "unsealed" | "sealed", typed: string | null = "Typed") {
  const title = mode === "sealed" ? await sealedTitle() : liveTitle();
  const held: Array<() => void> = [];
  const onCommit = vi.fn(
    (_: InlineTextEditCommit) => new Promise<void>((resolve) => held.push(resolve)),
  );
  cleanups.push(() => held.splice(0).forEach((land) => land()));
  const onLost = vi.fn<(reason: string) => void>();
  let controls!: ReturnType<typeof useInlineTextEdit>;
  const root = createRoot(document.createElement("div"));
  act(() =>
    root.render(
      createElement(() => {
        controls = useInlineTextEdit({ onCommit, onLost });
        return null;
      }),
    ),
  );
  cleanups.unshift(() => act(() => root.unmount()));
  act(() => void controls.start(title.target));
  await vi.waitFor(() => expect(title.shown.hasAttribute("contenteditable")).toBe(true));
  if (typed !== null) title.shown.innerHTML = typed;
  const blur = () => title.shown.dispatchEvent(new FocusEvent("blur"));
  const land = () => held.splice(0).forEach((resolve) => resolve());
  const reopen = async (typed: string) => {
    act(() => void controls.start(title.target));
    await vi.waitFor(() => expect(controls.session).not.toBeNull());
    await title.caughtUp?.();
    await vi.waitFor(() => expect(title.shown.hasAttribute("contenteditable")).toBe(true));
    title.shown.innerHTML = typed;
  };
  return {
    ...title,
    onCommit,
    onLost,
    blur,
    land,
    reopen,
    controls: () => controls,
    session: () => controls.session,
    unmount: () => act(() => root.unmount()),
  };
}

type Edit = Awaited<ReturnType<typeof openEdit>>;

/** The drain started by Export or Share: it must not finish before the typed text is saved. */
async function drainWaitsForTheSave(edit: Edit, drain: Promise<unknown>) {
  let drained = false;
  void drain.then(() => (drained = true));
  await vi.waitFor(() => expect(edit.onCommit).toHaveBeenCalledOnce());
  await nextTask();
  expect(drained).toBe(false);
  edit.land();
  await drain;
  expect(edit.onCommit).toHaveBeenCalledOnce();
  expect(edit.onCommit).toHaveBeenCalledWith(expect.objectContaining({ html: "Typed" }));
}

describe.each(["unsealed", "sealed"] as const)("an inline text edit, %s", (mode) => {
  it("is saved before a drain finishes when the blur message came first", async () => {
    const edit = await openEdit(mode);
    act(() => void edit.blur());
    await vi.waitFor(() => expect(edit.onCommit).toHaveBeenCalledOnce());
    await drainWaitsForTheSave(edit, flushStudioPendingEdits());
  });

  it("is saved before a drain finishes when the blur message is still on its way", async () => {
    const edit = await openEdit(mode);
    let drain!: Promise<unknown>;
    act(() => {
      edit.blur();
      drain = flushStudioPendingEdits();
    });
    await drainWaitsForTheSave(edit, drain);
  });

  it("is saved before a drain finishes when no blur ever comes", async () => {
    const edit = await openEdit(mode);
    await drainWaitsForTheSave(edit, flushStudioPendingEdits());
    expect(edit.session()).toBeNull();
  });

  it("ends, offering what was typed, when its element is removed mid-edit", async () => {
    const edit = await openEdit(mode);
    act(() => edit.remove());
    await vi.waitFor(() => expect(edit.session()).toBeNull());
    await drainWaitsForTheSave(edit, flushStudioPendingEdits());
  });

  it("leaves no draft on an element removed mid-edit, so it shows the original when it comes back", async () => {
    const edit = await openEdit(mode);
    act(() => edit.remove());
    await vi.waitFor(() => expect(edit.session()).toBeNull());
    await drainWaitsForTheSave(edit, flushStudioPendingEdits());
    edit.putBack();
    expect([edit.shown.innerHTML, edit.shown.hasAttribute("contenteditable")]).toEqual([
      "Hello",
      false,
    ]);
  });

  it("settles with no save and no message when its untouched element is removed", async () => {
    const edit = await openEdit(mode, null);
    act(() => edit.remove());
    await vi.waitFor(() => expect(edit.session()).toBeNull());
    await flushStudioPendingEdits();
    await nextTask();
    expect(edit.onCommit).not.toHaveBeenCalled();
    expect(edit.onLost).not.toHaveBeenCalled();
  });

  it("finishes its save when its element is removed while saving", async () => {
    const edit = await openEdit(mode);
    act(() => void edit.blur());
    await vi.waitFor(() => expect(edit.onCommit).toHaveBeenCalledOnce());
    act(() => edit.remove());
    await drainWaitsForTheSave(edit, flushStudioPendingEdits());
  });
});

it("says the text edit was not saved when the sealed frame never answers, and lets the drain finish", async () => {
  const edit = await openEdit("sealed");
  edit.silenceEnds!();
  const drain = flushStudioPendingEdits();
  await nextTask();
  edit.frameReloads!();
  await drain;
  expect(edit.onCommit).not.toHaveBeenCalled();
  expect(edit.onLost).toHaveBeenCalledOnce();
  expect(edit.session()).toBeNull();
});

describe("a sealed inline text edit reopened before its first end settled", () => {
  it("keeps the newer draft when the first end goes unanswered", async () => {
    const edit = await openEdit("sealed");
    edit.silenceEnds!();
    act(() => edit.controls().commit());
    const reopened = edit.reopen("Second");
    edit.frameReloads!();
    await vi.waitFor(() => expect(edit.onLost).toHaveBeenCalledOnce());
    await reopened;
    await nextTask();
    expect([edit.shown.innerHTML, edit.shown.hasAttribute("contenteditable")]).toEqual([
      "Second",
      true,
    ]);
    expect(edit.session()).not.toBeNull();
  });

  it("settles only its own edit when the first end answers late", async () => {
    const edit = await openEdit("sealed");
    const release = edit.holdEndReplies!();
    act(() => edit.controls().commit());
    const reopened = edit.reopen("Second");
    release();
    await vi.waitFor(() => expect(edit.onCommit).toHaveBeenCalledOnce());
    expect(edit.onCommit).toHaveBeenCalledWith(expect.objectContaining({ html: "Typed" }));
    edit.land();
    await reopened;
    await nextTask();
    expect([edit.shown.innerHTML, edit.shown.hasAttribute("contenteditable")]).toEqual([
      "Second",
      true,
    ]);
    expect(edit.session()).not.toBeNull();
  });
});

describe("an unsealed inline text edit", () => {
  it("closes when its element is removed before it ever got focus", async () => {
    const title = liveTitle();
    const onCommit = vi.fn(async (_: InlineTextEditCommit) => {});
    let controls!: ReturnType<typeof useInlineTextEdit>;
    const root = createRoot(document.createElement("div"));
    act(() =>
      root.render(
        createElement(() => {
          controls = useInlineTextEdit({ onCommit });
          return null;
        }),
      ),
    );
    cleanups.unshift(() => act(() => root.unmount()));
    act(() => {
      controls.start(title.target);
      title.remove();
    });
    await vi.waitFor(() => expect(controls.session).toBeNull());
    expect([title.shown.hasAttribute("contenteditable"), title.shown.style.outline]).toEqual([
      false,
      "",
    ]);
    expect(title.watching!()).toBe(0);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it.each([
    ["saved", (edit: Edit) => edit.blur()],
    ["cancelled", (edit: Edit) => edit.controls().cancel()],
    ["removed", (edit: Edit) => edit.remove()],
    ["unmounted", (edit: Edit) => edit.unmount()],
  ])("watches its document for removal only while open: %s", async (_, settle) => {
    const edit = await openEdit("unsealed");
    expect(edit.watching!()).toBe(1);
    act(() => void settle(edit));
    await vi.waitFor(() => expect(edit.watching!()).toBe(0));
    edit.land();
  });
});
