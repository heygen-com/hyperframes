// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { TextEditSelectionEvent } from "@hyperframes/core/runtime/editing-port";
import { cleanupMounted, trackedRoot } from "../ui/mountHost.testHelpers";
import { CARET_PX, InlineTextCaret } from "./InlineTextCaret";

const frame = vi.hoisted(() => ({
  listeners: new Set<(event: TextEditSelectionEvent) => void>(),
}));
vi.mock("../../player/lib/previewChannel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewChannel")>()),
  previewEditingClient: () => ({
    onTextEditSelection: (listener: (event: TextEditSelectionEvent) => void) => {
      frame.listeners.add(listener);
      return () => frame.listeners.delete(listener);
    },
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HANDLE = "0123456789abcdef:1";

afterEach(() => {
  cleanupMounted();
  document.body.innerHTML = "";
  frame.listeners.clear();
});

/** A sealed frame 1600 px wide in its own px, shown 400 px wide from 100,50 on Studio's screen. */
function sealedCaret() {
  const iframe = document.createElement("iframe");
  iframe.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 225 }) as DOMRect;
  document.body.append(iframe);
  const session = {
    element: document.createElement("h1"),
    original: "Launch day news",
    outline: "",
    outlineOffset: "",
    sealed: { iframe, handle: HANDLE },
  };
  const root = trackedRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<InlineTextCaret session={session} iframe={iframe} />));
}

const posted = (handle: string, caret: TextEditSelectionEvent["caret"]) =>
  act(() => frame.listeners.forEach((listener) => listener({ handle, selection: null, caret })));
const drawn = () => document.querySelector<HTMLElement>("[data-inline-text-caret]");
const CARET = {
  left: 400,
  top: 200,
  height: 120,
  color: "rgb(250, 250, 250)",
  viewportWidth: 1600,
};

it("draws a sealed frame's caret at screen size where the frame reports it", () => {
  sealedCaret();
  expect(drawn()).toBeNull();
  posted(HANDLE, CARET);
  const caret = drawn();
  expect(caret).not.toBeNull();
  expect(caret!.style.left).toBe(`${100 + 400 / 4 - CARET_PX / 2}px`);
  expect(caret!.style.top).toBe(`${50 + 200 / 4}px`);
  expect(caret!.style.height).toBe(`${120 / 4}px`);
  expect(caret!.style.width).toBe(`${CARET_PX}px`);
  expect(caret!.style.background).toBe("rgb(250, 250, 250)");
});

it("draws nothing for another session's caret, and takes the caret away when the frame has none", () => {
  sealedCaret();
  posted("fedcba9876543210:2", CARET);
  expect(drawn()).toBeNull();
  posted(HANDLE, CARET);
  expect(drawn()).not.toBeNull();
  posted(HANDLE, null);
  expect(drawn()).toBeNull();
});

it("keeps a sealed frame's caret inside the preview's box, wherever the frame says it stands", () => {
  sealedCaret();
  posted(HANDLE, { ...CARET, left: 1e6, top: -1e6, height: 1e7 });
  const caret = drawn();
  expect(caret).not.toBeNull();
  expect(caret!.style.left).toBe(`${100 + 400 - CARET_PX}px`);
  expect(caret!.style.top).toBe("50px");
  expect(caret!.style.height).toBe("225px");
  posted(HANDLE, { ...CARET, top: 1e6 });
  expect(drawn()).toBeNull();
});
