// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import React, { act, useRef } from "react";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditing";
import { usePlayerStore } from "../player/store/playerStore";
import { useAppHotkeys } from "./useAppHotkeys";
import { mountReactHarness } from "./domSelectionTestHarness";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { APP_HOTKEY_ACTIONS } from "./appHotkeysDispatch";
import { PLAYBACK_ACTIONS } from "../player/hooks/usePlaybackKeyboard";
import { DEFAULT_STUDIO_KEYS } from "../player/components/studioShortcuts";
import {
  detachedFakeIframe,
  serveEditingRequests,
} from "../player/hooks/timelinePlayerTestHarness";
import { previewRequest } from "../player/lib/previewChannel";

vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const domDelete = vi.fn(async () => undefined);
const historyUndo = vi.fn(async () => ({ ok: false }));
const historyRedo = vi.fn(async () => ({ ok: false }));
const settle = vi.fn(async () => undefined);
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
    handleTimelineElementsDelete: vi.fn(async () => undefined),
    handleTimelineElementSplit: vi.fn(async () => undefined),
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
    writeProjectFile: vi.fn(async () => undefined),
    showToast: vi.fn(),
    syncHistoryPreviewAfterApply: vi.fn(async () => undefined),
    settlePendingEdits: settle,
    handleCopy: vi.fn(() => false),
    handlePaste: vi.fn(() => false),
    handleCut: vi.fn(() => false),
    onResetKeyframes: vi.fn(() => false),
    onDeleteSelectedKeyframes: vi.fn(),
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
    function sealedFrame(focus = { inPreview: true }) {
      const frame: Record<string, unknown> = {};
      const iframe = detachedFakeIframe(frame);
      const hasFocus = vi.spyOn(document, "hasFocus").mockImplementation(() => focus.inPreview);
      Object.defineProperty(document, "activeElement", {
        configurable: true,
        get: () => (focus.inPreview ? iframe : document.body),
      });
      closers.push(() => {
        hasFocus.mockRestore();
        delete (document as { activeElement?: unknown }).activeElement;
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
      const keyDown = (key: string, code: string) =>
        ports.at(-1)!.postMessage({
          v: 1,
          event: "key",
          key: {
            type: "keydown",
            key,
            code,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            repeat: false,
          },
        });
      return { iframe, watched, ports, keyDown, hasFocus };
    }

    it("leaves Studio's own reads of the preview answered while it forwards keys", async () => {
      root = mountReactHarness(<Harness />);
      const { iframe, watched } = sealedFrame();
      let read: Promise<unknown> | undefined;
      act(() => {
        sync?.(iframe);
        read = previewRequest(iframe, "max-z-index", {}, 1_000);
      });
      await vi.waitFor(() => expect(watched).toHaveLength(1));
      await expect(read).resolves.toEqual({ zIndex: 7 });
    });

    it("deletes the selection on a Delete pressed inside the preview", async () => {
      root = mountReactHarness(<Harness />);
      const { iframe, watched, keyDown } = sealedFrame();
      act(() => sync?.(iframe));
      await vi.waitFor(() => expect(watched).toHaveLength(1));
      expect(new Set(watched[0])).toEqual(
        new Set(APP_HOTKEY_ACTIONS.map((action) => DEFAULT_STUDIO_KEYS[action])),
      );
      keyDown("Delete", "Delete");
      await vi.waitFor(() => expect(domDelete).toHaveBeenCalledTimes(1));
    });

    it("ignores a key the preview reports while the person is not in the preview", async () => {
      root = mountReactHarness(<Harness />);
      const focus = { inPreview: false };
      const { iframe, watched, keyDown, hasFocus } = sealedFrame(focus);
      act(() => sync?.(iframe));
      await vi.waitFor(() => expect(watched).toHaveLength(1));
      keyDown("Delete", "Delete");
      await vi.waitFor(() => expect(hasFocus).toHaveBeenCalledTimes(1));
      focus.inPreview = true;
      keyDown("Delete", "Delete");
      await vi.waitFor(() => expect(domDelete).toHaveBeenCalledTimes(1));
      expect(hasFocus).toHaveBeenCalledTimes(2);
    });

    it("stops watching on the preview's next load, from a new port", async () => {
      root = mountReactHarness(<Harness />);
      const { iframe, watched, ports } = sealedFrame();
      act(() => sync?.(iframe));
      await vi.waitFor(() => expect(watched).toHaveLength(1));
      act(() => sync?.(iframe));
      await vi.waitFor(() => expect(watched).toHaveLength(3));
      expect(watched.slice(1)).toContainEqual([]);
      expect(ports).toHaveLength(2);
    });

    it("watches every action the app's key dispatchers answer, so none is dead in a sealed preview", () => {
      const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
      const answered = new Set([
        ...[...read("./appHotkeysDispatch.ts").matchAll(/matchesKey\(\w+, "(\w+)"\)/g)].map(
          (m) => m[1],
        ),
        ...[...read("./linkShortcuts.ts").matchAll(/\["(\w+)", "\w+"\]/g)].map((m) => m[1]),
      ]);
      expect(answered.size).toBeGreaterThan(20);
      expect(new Set(APP_HOTKEY_ACTIONS)).toEqual(answered);
    });

    it("watches no key the playback keys also watch, so the frame forwards each press once", () => {
      const app = new Set(APP_HOTKEY_ACTIONS.map((action) => DEFAULT_STUDIO_KEYS[action]));
      const shared = PLAYBACK_ACTIONS.map((action) => DEFAULT_STUDIO_KEYS[action]).filter((combo) =>
        app.has(combo),
      );
      expect(shared).toEqual([]);
    });
  });
});
