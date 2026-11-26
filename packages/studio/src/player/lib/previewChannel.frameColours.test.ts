// @vitest-environment happy-dom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TextEditSelectionEvent } from "@hyperframes/core/runtime/editing-port";

const fake = vi.hoisted(() => ({
  listeners: new Set<(event: TextEditSelectionEvent) => void>(),
}));
vi.mock("@hyperframes/core/runtime/editing-port", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/core/runtime/editing-port")>()),
  createEditingPortClient: () => ({
    onTextEditSelection: (listener: (event: TextEditSelectionEvent) => void) => {
      fake.listeners.add(listener);
      return () => fake.listeners.delete(listener);
    },
    dispose: () => {},
  }),
}));

const { previewEditingClient, retirePreviewEditingClient } = await import("./previewChannel");

const BEACON = "url(https://probe.invalid/beacon)";
const HANDLE = "0123456789abcdef:1";

// happy-dom's CSS.supports says yes to any value; Chrome's says no to a url() as a colour, as
// InlineTextToolbar.browser.test.ts checks through this same filter.
beforeEach(() => {
  vi.stubGlobal("CSS", {
    supports: (property: string, value?: string) =>
      property === "color" && !/url\(|;/i.test(value ?? ""),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  fake.listeners.clear();
  document.body.innerHTML = "";
});

function received(event: TextEditSelectionEvent): TextEditSelectionEvent[] {
  const iframe = document.body.appendChild(document.createElement("iframe"));
  const seen: TextEditSelectionEvent[] = [];
  previewEditingClient(iframe).onTextEditSelection((each) => seen.push(each));
  fake.listeners.forEach((listener) => listener(event));
  retirePreviewEditingClient(iframe);
  return seen;
}

it("hands Studio a sealed frame's caret only when its colour is a colour, never a url() beacon", () => {
  const caret = { left: 1, top: 2, height: 20, color: BEACON, viewportWidth: 1600 };
  const [event] = received({ handle: HANDLE, selection: null, caret });
  expect(event).toEqual({ handle: HANDLE, selection: null, caret: null });
  const [kept] = received({
    handle: HANDLE,
    selection: null,
    caret: { ...caret, color: "rgb(1, 2, 3)" },
  });
  expect(kept?.caret?.color).toBe("rgb(1, 2, 3)");
});

it("hands Studio a sealed frame's selection colours only when they are colours", () => {
  const [event] = received({
    handle: HANDLE,
    caret: null,
    selection: {
      rect: { x: 1, y: 2, width: 3, height: 4 },
      viewportWidth: 1600,
      styles: { color: BEACON, "font-weight": "700" },
      colours: [BEACON, "rgb(4, 5, 6)"],
      painted: BEACON,
    },
  });
  expect(JSON.stringify(event)).not.toContain("url(");
  expect(event?.selection?.styles).toEqual({ "font-weight": "700" });
  expect(event?.selection?.colours).toEqual(["rgb(4, 5, 6)"]);
  expect(event?.selection?.painted).toBeNull();
});
