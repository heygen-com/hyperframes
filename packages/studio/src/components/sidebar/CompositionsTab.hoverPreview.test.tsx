// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountCompositionsTab } from "./compositionsTabTestUtils";

type PostedControl = { source: string; type: string; action: string; muted?: boolean };

function hoverPreview() {
  const host = mountCompositionsTab();
  const card = host.querySelector<HTMLElement>('[draggable="true"]');
  if (!card) throw new Error("composition card did not render");
  act(() => {
    card.dispatchEvent(new Event("pointerover", { bubbles: true }));
    vi.advanceTimersByTime(300);
  });
  const iframe = host.querySelector("iframe");
  if (!iframe) throw new Error("hover preview did not mount");
  // Stand-in for the frame's window. The document getter throws, as reading into
  // an opaque-origin frame would, so any read the card made would fail the test.
  const frameWindow = { postMessage: vi.fn() };
  Object.defineProperty(iframe, "contentWindow", { configurable: true, get: () => frameWindow });
  Object.defineProperty(iframe, "contentDocument", {
    configurable: true,
    get: () => {
      throw new Error("the hover preview must not read the frame document");
    },
  });
  return { iframe, frameWindow };
}

function fromFrame(source: unknown, data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "hf-preview", ...data },
        source: source as MessageEventSource,
      }),
    );
  });
}

const posted = (frameWindow: { postMessage: ReturnType<typeof vi.fn> }) =>
  frameWindow.postMessage.mock.calls.map(([message]) => message as PostedControl);

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.useRealTimers();
});

describe("composition card hover preview", () => {
  it("frames the composition in an opaque origin", () => {
    const { iframe } = hoverPreview();
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.sandbox.contains("allow-scripts")).toBe(true);
    expect(iframe.sandbox.contains("allow-same-origin")).toBe(false);
  });

  it("plays muted over the runtime bridge once the runtime is listening", () => {
    const { frameWindow } = hoverPreview();
    expect(frameWindow.postMessage).not.toHaveBeenCalled();

    fromFrame(frameWindow, { type: "ready" });

    expect(posted(frameWindow).map(({ source, type, action }) => [source, type, action])).toEqual([
      ["hf-parent", "control", "set-muted"],
      ["hf-parent", "control", "play"],
    ]);
    expect(posted(frameWindow)[0]?.muted).toBe(true);
    for (const [, targetOrigin] of frameWindow.postMessage.mock.calls) {
      expect(targetOrigin).toBe("*");
    }
  });

  it("sizes the stage from the runtime's timeline message", () => {
    const { iframe, frameWindow } = hoverPreview();
    expect([iframe.style.width, iframe.style.height]).toEqual(["1920px", "1080px"]);

    fromFrame(frameWindow, { type: "timeline", compositionWidth: 1080, compositionHeight: 1920 });

    expect([iframe.style.width, iframe.style.height]).toEqual(["1080px", "1920px"]);
  });

  it("ignores runtime messages that come from another window", () => {
    const { iframe, frameWindow } = hoverPreview();

    fromFrame({ postMessage: vi.fn() }, { type: "ready" });
    fromFrame(window, { type: "timeline", compositionWidth: 640, compositionHeight: 640 });

    expect(frameWindow.postMessage).not.toHaveBeenCalled();
    expect([iframe.style.width, iframe.style.height]).toEqual(["1920px", "1080px"]);
  });
});
