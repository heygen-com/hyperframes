// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LintFinding } from "../components/LintModal";
import { useConsoleErrorCapture } from "./useConsoleErrorCapture";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** One snapshot per render, so the assertions read a list instead of a mutated binding. */
const captured: (LintFinding[] | null)[] = [];

function Probe({ iframe }: { iframe: HTMLIFrameElement | null }) {
  const { consoleErrors } = useConsoleErrorCapture(iframe);
  captured.push(consoleErrors);
  return null;
}

function latest(): LintFinding[] | null {
  return captured[captured.length - 1] ?? null;
}

/** jsdom types `contentWindow` as the bare `Window`, which has no `console`. */
function previewWindow(frame: HTMLIFrameElement): Window & typeof globalThis {
  const win = frame.contentWindow as (Window & typeof globalThis) | null;
  if (!win) throw new Error("iframe has no content window");
  return win;
}

let iframe: HTMLIFrameElement;
let unmount: () => void;

beforeEach(() => {
  captured.length = 0;
  iframe = document.createElement("iframe");
  document.body.append(iframe);
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe iframe={iframe} />));
  unmount = () => act(() => root.unmount());
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("useConsoleErrorCapture", () => {
  it("collects a console.error from the preview window", () => {
    act(() => previewWindow(iframe).console.error("boom", new Error("detail")));

    expect(latest()).toEqual([{ severity: "error", message: "boom detail" }]);
    unmount();
  });

  it("drops the favicon noise every preview emits", () => {
    act(() => previewWindow(iframe).console.error("GET /favicon.ico 404"));

    expect(latest()).toBeNull();
    unmount();
  });

  it("collects an uncaught error event from the preview window", () => {
    act(() => {
      previewWindow(iframe).dispatchEvent(new ErrorEvent("error", { message: "threw" }));
    });

    expect(latest()).toEqual([{ severity: "error", message: "threw" }]);
    unmount();
  });

  it("restores the preview's console.error on unmount", () => {
    const win = previewWindow(iframe);
    const patched = win.console.error;

    unmount();

    expect(win.console.error).not.toBe(patched);
    act(() => win.console.error("after"));
    expect(latest()).toBeNull();
  });
});
