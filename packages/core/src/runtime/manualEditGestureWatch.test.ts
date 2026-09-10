import { afterEach, describe, expect, it, vi } from "vitest";
import { STUDIO_MANUAL_EDIT_GESTURE_ATTR } from "../editing/draftMarkers";
import { createManualEditGestureWatch } from "./manualEditGestureWatch";

const flush = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

describe("manual-edit gesture watch", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("reports a gesture and calls back when the marker appears and clears", async () => {
    document.body.innerHTML = `<div id="a"></div>`;
    const changes: number[] = [];
    const watch = createManualEditGestureWatch(document, () => changes.push(1));
    try {
      expect(watch.observing).toBe(true);
      expect(watch.isActive()).toBe(false);

      const el = document.getElementById("a")!;
      el.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, "token");
      // Correct within the task, before the observer's microtask has run —
      // and reading it must not swallow the change notification, because that
      // notification is what un-parks the transport.
      expect(watch.isActive()).toBe(true);
      expect(changes.length).toBeGreaterThan(0);
      await flush();

      el.removeAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
      expect(watch.isActive()).toBe(false);
    } finally {
      watch.disconnect();
    }
  });

  it("stops reporting a gesture whose element was torn out mid-drag", async () => {
    document.body.innerHTML = `<div id="a"></div>`;
    const watch = createManualEditGestureWatch(document, () => {});
    try {
      const el = document.getElementById("a")!;
      el.setAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR, "token");
      expect(watch.isActive()).toBe(true);
      // A hot reload during a drag: the marked element can never clear itself.
      el.remove();
      await flush();
      expect(watch.isActive()).toBe(false);
    } finally {
      watch.disconnect();
    }
  });

  it("seeds from a marker that was already on the document when it attached", () => {
    document.body.innerHTML = `<div id="a" ${STUDIO_MANUAL_EDIT_GESTURE_ATTR}="token"></div>`;
    const watch = createManualEditGestureWatch(document, () => {});
    try {
      expect(watch.isActive()).toBe(true);
    } finally {
      watch.disconnect();
    }
  });

  it("reports observing:false, and keeps answering, where MutationObserver is absent", () => {
    document.body.innerHTML = `<div id="a" ${STUDIO_MANUAL_EDIT_GESTURE_ATTR}="token"></div>`;
    // A document whose view has no MutationObserver. `observing` false is the
    // contract a caller reads before deciding it may stop asking: on this path
    // `onChange` never fires, so nothing can be woken by a gesture.
    const viewless = {
      documentElement: document.documentElement,
      defaultView: { MutationObserver: undefined },
      querySelector: (s: string) => document.querySelector(s),
      querySelectorAll: (s: string) => document.querySelectorAll(s),
    } as unknown as Document;
    const realObserver = globalThis.MutationObserver;
    // @ts-expect-error stripping the capability under test
    delete globalThis.MutationObserver;
    try {
      const changes: number[] = [];
      const watch = createManualEditGestureWatch(viewless, () => changes.push(1));
      expect(watch.observing).toBe(false);
      expect(watch.isActive()).toBe(true);
      document.getElementById("a")!.removeAttribute(STUDIO_MANUAL_EDIT_GESTURE_ATTR);
      expect(watch.isActive()).toBe(false);
      expect(changes).toHaveLength(0);
      watch.disconnect();
    } finally {
      globalThis.MutationObserver = realObserver;
    }
  });
});
