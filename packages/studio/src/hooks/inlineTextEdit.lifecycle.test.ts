// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findPreviewElementForSelection,
  resolvePreviewSelection,
} from "../components/editor/previewSelection";
import { retirePreviewEditingClient } from "../player/lib/previewChannel";
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
  /** What Chrome does when a focused element leaves the document (checked in Chrome 155). */
  remove: () => void;
  silenceEnds?: () => void;
  frameReloads?: () => void;
}

function liveTitle(): Title {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  frame.contentDocument!.body.innerHTML = `<h1 id="title">Hello</h1>`;
  const shown = frame.contentDocument!.getElementById("title")!;
  const remove = () => {
    shown.remove();
    shown.dispatchEvent(new FocusEvent("blur"));
  };
  return { target: shown, shown, remove };
}

async function sealedTitle(): Promise<Title> {
  document.body.innerHTML = `<h1 id="title">Hello</h1>`;
  const shown = document.getElementById("title")!;
  let answersEnd = true;
  const { iframe } = sealedPreviewFrame({
    wrapHandedOverPort: (port) => {
      const send = port.postMessage.bind(port);
      port.postMessage = (data: unknown) => {
        const message = data as { kind?: string; params?: { action?: string } };
        if (!answersEnd && message.kind === "text-edit" && message.params?.action === "end") return;
        send(data);
      };
      return port;
    },
  });
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
    silenceEnds: () => (answersEnd = false),
    frameReloads: () => iframe.dispatchEvent(new Event("load")),
  };
}

async function openEdit(mode: "unsealed" | "sealed") {
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
  title.shown.innerHTML = "Typed";
  const blur = () => title.shown.dispatchEvent(new FocusEvent("blur"));
  const land = () => held.splice(0).forEach((resolve) => resolve());
  return { ...title, onCommit, onLost, blur, land, session: () => controls.session };
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
