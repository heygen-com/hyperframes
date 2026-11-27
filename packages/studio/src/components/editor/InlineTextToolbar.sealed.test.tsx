// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { TextEditSelectionEvent } from "@hyperframes/core/runtime/editing-port";
import { cleanupMounted, trackedRoot } from "../ui/mountHost.testHelpers";
import { InlineTextToolbar } from "./InlineTextToolbar";

const frame = vi.hoisted(() => ({
  listeners: new Set<(event: TextEditSelectionEvent) => void>(),
  textEdit: vi.fn(async () => null),
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
vi.mock("../../player/lib/previewElements", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../player/lib/previewElements")>()),
  previewTextEdit: frame.textEdit,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HANDLE = "0123456789abcdef:1";

afterEach(() => {
  cleanupMounted();
  document.body.innerHTML = "";
  frame.listeners.clear();
  frame.textEdit.mockClear();
});

function sealedToolbar() {
  const iframe = document.createElement("iframe");
  iframe.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400 }) as DOMRect;
  document.body.append(iframe);
  const session = {
    element: document.createElement("h1"),
    original: "Launch day news",
    outline: "",
    outlineOffset: "",
    sealed: { iframe, handle: HANDLE },
  };
  const root = trackedRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<InlineTextToolbar session={session} iframe={iframe} />));
  return iframe;
}

const selected = (styles: Record<string, string>, colours: string[], painted: string | null) =>
  act(() =>
    frame.listeners.forEach((listener) =>
      listener({
        handle: HANDLE,
        caret: null,
        selection: {
          rect: { x: 200, y: 400, width: 100, height: 40 },
          viewportWidth: 1600,
          styles,
          colours,
          painted,
        },
      }),
    ),
  );
const toolbar = () => document.querySelector<HTMLElement>("[data-inline-text-toolbar]");

it("shows over a sealed frame's selection, and sends a press to the frame to style its own selection", () => {
  sealedToolbar();
  expect(toolbar()).toBeNull();
  selected({ "font-weight": "700" }, [], "rgb(255, 255, 255)");
  expect(toolbar()!.style.left).toBe(`${100 + 250 / 4}px`);
  const bold = toolbar()!.querySelector<HTMLButtonElement>('[aria-label="Bold"]')!;
  expect(bold.getAttribute("aria-pressed")).toBe("true");
  act(() => bold.click());
  expect(frame.textEdit).toHaveBeenCalledWith(expect.anything(), {
    handle: HANDLE,
    action: "style",
    style: { "font-weight": null },
  });
  act(() =>
    frame.listeners.forEach((listener) =>
      listener({ handle: HANDLE, selection: null, caret: null }),
    ),
  );
  expect(toolbar()).toBeNull();
});
