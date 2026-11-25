// @vitest-environment happy-dom

import React, { act, useRef } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { usePlayerStore } from "../player/store/playerStore";
import { useAppHotkeys } from "./useAppHotkeys";
import { mountReactHarness } from "./domSelectionTestHarness";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { DEFAULT_STUDIO_KEYS } from "../player/components/studioShortcuts";
import {
  detachedFakeIframe,
  serveEditingRequests,
} from "../player/hooks/timelinePlayerTestHarness";
import { previewRequest } from "../player/lib/previewChannel";
import { parseCombo } from "@hyperframes/core/key-combo";

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const domDelete = vi.fn(async () => undefined);
const historyUndo = vi.fn(async () => ({ ok: false }));
const historyRedo = vi.fn(async () => ({ ok: false }));
const settle = vi.fn(async () => undefined);
const changes = {
  timelineDelete: vi.fn(async () => undefined),
  split: vi.fn(async () => undefined),
  write: vi.fn(async () => undefined),
  copy: vi.fn(() => false),
  paste: vi.fn(() => false),
  cut: vi.fn(() => false),
  duplicate: vi.fn(async () => false),
  group: vi.fn(),
  ungroup: vi.fn(),
  record: vi.fn(),
  resetKeyframes: vi.fn(() => false),
  deleteKeyframes: vi.fn(),
};
let readOnlyPreview = false;
let root: Root | null = null;
let sync: ((iframe: HTMLIFrameElement | null) => void) | null = null;

function selection(): DomEditSelection {
  const element = document.createElement("section");
  element.id = "card";
  return {
    element,
    id: "card",
    selector: "#card",
    selectorIndex: 0,
    sourceFile: "index.html",
  } as unknown as DomEditSelection;
}

function Harness() {
  const selectionRef = useRef<DomEditSelection | null>(selection());
  const hotkeys = useAppHotkeys({
    handleTimelineElementsDelete: changes.timelineDelete,
    handleTimelineElementSplit: changes.split,
    handleDomEditElementDelete: domDelete,
    domEditSelectionRef: selectionRef,
    clearDomSelectionRef: useRef<() => void>(() => undefined),
    editHistory: {
      undo: historyUndo,
      redo: historyRedo,
      state: { undo: [], redo: [] },
    },
    readOptionalProjectFile: vi.fn(async () => ""),
    readProjectFile: vi.fn(async () => ""),
    writeProjectFile: changes.write,
    showToast: vi.fn(),
    syncHistoryPreviewAfterApply: vi.fn(async () => undefined),
    settlePendingEdits: settle,
    handleCopy: changes.copy,
    handlePaste: changes.paste,
    handleCut: changes.cut,
    handleDuplicate: changes.duplicate,
    onGroupSelection: changes.group,
    onUngroupSelection: changes.ungroup,
    onToggleRecording: changes.record,
    onResetKeyframes: changes.resetKeyframes,
    onDeleteSelectedKeyframes: changes.deleteKeyframes,
    readOnlyPreview,
    onAfterUndoRedo: vi.fn(),
  } as unknown as Parameters<typeof useAppHotkeys>[0]);
  sync = hotkeys.syncPreviewHotkeys;
  return null;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
  domDelete.mockClear();
  for (const change of Object.values(changes)) change.mockClear();
  readOnlyPreview = false;
  historyUndo.mockClear();
  historyRedo.mockClear();
  settle.mockReset();
  settle.mockImplementation(async () => undefined);
  vi.mocked(trackStudioEvent).mockClear();
});

describe("preview iframe hotkey forwarding", () => {
  it("still delivers Delete after the preview reloads", () => {
    // A reload keeps the iframe element (no ref callback) and the same
    // WindowProxy (an identity check sees no change) but replaces the window
    // holding the listeners. Attaching once left Delete dead inside the canvas
    // after the first reload — and clicking the canvas is what puts focus there.
    root = mountReactHarness(<Harness />);

    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    act(() => sync?.(iframe));

    // The reload: same element, a window that has lost its listeners.
    act(() => sync?.(iframe));

    const inner = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!inner) throw new Error("expected an iframe window");
    inner.document.body.dispatchEvent(
      new inner.KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );

    expect(domDelete).toHaveBeenCalledTimes(1);
  });

  function mountWithPreview(): Window & typeof globalThis {
    root = mountReactHarness(<Harness />);
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    act(() => sync?.(iframe));
    const inner = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!inner) throw new Error("expected an iframe window");
    return inner;
  }

  async function press(inner: Window & typeof globalThis, init: KeyboardEventInit) {
    await act(async () => {
      inner.document.body.dispatchEvent(
        new inner.KeyboardEvent("keydown", { ...init, bubbles: true }),
      );
    });
  }

  it("takes one tracked undo step per Cmd+Z pressed inside the preview", async () => {
    await press(mountWithPreview(), { key: "z", ctrlKey: true });

    expect(historyUndo).toHaveBeenCalledTimes(1);
    expect(trackStudioEvent).toHaveBeenCalledTimes(1);
    expect(trackStudioEvent).toHaveBeenCalledWith("keyboard_shortcut", { action: "undo" });
  });

  it("settles pending edits, failed ones included, before Cmd+Z steps the history", async () => {
    let settled!: () => void;
    settle.mockImplementation(
      () => new Promise<undefined>((resolve) => (settled = () => resolve(undefined))),
    );
    await press(mountWithPreview(), { key: "z", ctrlKey: true });
    expect(settle).toHaveBeenCalledTimes(1);
    expect(historyUndo).not.toHaveBeenCalled();
    await act(async () => settled());
    expect(historyUndo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Shift+Cmd+Z", { key: "Z", metaKey: true, shiftKey: true }],
    ["Ctrl+Y", { key: "y", ctrlKey: true }],
  ])("takes one tracked redo step per %s pressed inside the preview", async (_, init) => {
    await press(mountWithPreview(), init);

    expect(historyRedo).toHaveBeenCalledTimes(1);
    expect(trackStudioEvent).toHaveBeenCalledTimes(1);
    expect(trackStudioEvent).toHaveBeenCalledWith("keyboard_shortcut", { action: "redo" });
  });

  it("stops handling preview keys once the app unmounts", async () => {
    root = mountReactHarness(<Harness />);
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const inner = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (!inner) throw new Error("expected an iframe window");
    const add = vi.spyOn(inner, "addEventListener");
    const remove = vi.spyOn(inner, "removeEventListener");
    act(() => sync?.(iframe));
    act(() => root?.unmount());
    root = null;

    await press(inner, { key: "z", ctrlKey: true });

    expect(historyUndo).not.toHaveBeenCalled();
    // happy-dom removes a listener whatever its capture flag; a browser does not, so pin the flag.
    expect(add).toHaveBeenCalled();
    expect(remove.mock.calls).toEqual(add.mock.calls);
  });

  describe("a sealed preview", () => {
    const closers: Array<() => void> = [];
    afterEach(() => closers.splice(0).forEach((close) => close()));

    // A frame whose document refuses Studio, reached only over the editing port it hands out per connect.
    async function sealedFrame() {
      const frame: Record<string, unknown> = {};
      const iframe = detachedFakeIframe(frame);
      const loaded = new Promise((resolve) =>
        iframe.addEventListener("load", resolve, { once: true }),
      );
      const player = document.createElement("div");
      document.body.append(player);
      const shadow = player.attachShadow({ mode: "open" });
      shadow.append(iframe);
      const focus = { inPreview: true };
      Object.defineProperty(shadow, "activeElement", {
        get: () => (focus.inPreview ? iframe : null),
      });
      const blur = vi.spyOn(iframe, "blur").mockImplementation(() => {
        focus.inPreview = false;
      });
      // A real press or click just happened: Studio's window holds transient activation throughout.
      Object.defineProperty(window.navigator, "userActivation", {
        configurable: true,
        get: () => ({ isActive: true, hasBeenActive: true }),
      });
      closers.push(() => {
        delete (window.navigator as { userActivation?: unknown }).userActivation;
        player.remove();
      });
      Object.defineProperty(iframe, "contentDocument", { value: null });
      Object.defineProperty(frame, "document", {
        get: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      });
      const watched: string[][] = [];
      const ports: MessagePort[] = [];
      closers.push(
        serveEditingRequests(
          frame,
          (kind, params) => {
            if (kind === "max-z-index") return { zIndex: 7 };
            if (kind !== "watch-keys") return null;
            watched.push((params as { combos: string[] }).combos);
            return { watching: watched.at(-1)!.length };
          },
          (port) => ports.push(port),
        ),
      );
      const report = (combo: string) => {
        const { mod, meta, ctrl, shift, alt, key } = parseCombo(combo)!;
        for (const port of ports) {
          port.postMessage({
            v: 1,
            event: "key",
            key: {
              type: "keydown",
              key,
              code: "",
              altKey: alt,
              ctrlKey: ctrl,
              metaKey: mod || meta,
              shiftKey: shift,
              repeat: false,
            },
          });
        }
      };
      const answered = () => previewRequest(iframe, "max-z-index", {}, 1_000);
      await loaded;
      return { iframe, focus, blur, watched, report, answered };
    }

    const changesMade = () =>
      [domDelete, historyUndo, historyRedo, ...Object.values(changes)].reduce(
        (n, spy) => n + spy.mock.calls.length,
        0,
      );

    // fails without the fix: a report the frame forged while a real press's activation lasted (about 5 s) acted.
    it("acts on no key the frame reports, even right after a real press", async () => {
      usePlayerStore.setState({
        selectedElementIds: new Set(["clip-a"]),
        selectedElementId: "clip-a",
      });
      root = mountReactHarness(<Harness />);
      const { iframe, watched, report, answered } = await sealedFrame();
      act(() => sync?.(iframe));
      await answered();
      for (const combo of Object.values(DEFAULT_STUDIO_KEYS)) report(combo);
      await answered();
      expect(watched).toEqual([]);
      expect(changesMade()).toBe(0);
    });

    // fails without the fix: focus could stay in the frame, where Studio only had the frame's word for a key.
    it("takes the keyboard back on the next task whenever focus moves into the frame", async () => {
      root = mountReactHarness(<Harness />);
      const { iframe, focus, blur } = await sealedFrame();
      act(() => sync?.(iframe));
      await vi.waitFor(() => expect(focus.inPreview).toBe(false));
      focus.inPreview = true;
      window.dispatchEvent(new Event("blur"));
      expect(focus.inPreview).toBe(true);
      await vi.waitFor(() => expect(focus.inPreview).toBe(false));
      expect(blur).toHaveBeenCalledTimes(2);
    });

    it("deletes the selection on a real Delete once Studio holds the keyboard", async () => {
      root = mountReactHarness(<Harness />);
      const { iframe } = await sealedFrame();
      act(() => sync?.(iframe));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", code: "Delete" }));
      await vi.waitFor(() => expect(domDelete).toHaveBeenCalledTimes(1));
    });

    it("stops taking focus from the frame once the preview is gone", async () => {
      root = mountReactHarness(<Harness />);
      const { iframe, focus, blur } = await sealedFrame();
      act(() => sync?.(iframe));
      await vi.waitFor(() => expect(blur).toHaveBeenCalledTimes(1));
      act(() => sync?.(null));
      focus.inPreview = true;
      window.dispatchEvent(new Event("blur"));
      // A task after the take-back would have run: it was queued first.
      await new Promise((settled) => setTimeout(settled, 0));
      expect(blur).toHaveBeenCalledTimes(1);
    });
  });
});
