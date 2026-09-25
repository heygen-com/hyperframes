// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player";
import { useNativeClipboardBroker } from "./useNativeClipboardBroker";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

interface HarnessResult {
  syncPreviewClipboard: (iframe: HTMLIFrameElement | null) => void;
  cleanup: () => void;
}

function renderHarness(handlers: {
  copy: (event: ClipboardEvent) => void;
  cut: (event: ClipboardEvent) => void;
  paste: (event: ClipboardEvent) => void;
}): HarnessResult {
  let syncPreviewClipboard: HarnessResult["syncPreviewClipboard"] | null = null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;

  function Harness() {
    syncPreviewClipboard = useNativeClipboardBroker({ handlers }).syncPreviewClipboard;
    return null;
  }

  act(() => {
    root = createRoot(host);
    root.render(createElement(Harness));
  });
  if (!syncPreviewClipboard) throw new Error("clipboard broker did not render");
  return {
    syncPreviewClipboard,
    cleanup: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  usePlayerStore.setState({ automationSelection: null });
});

describe("useNativeClipboardBroker", () => {
  it("forwards a native paste event from the Studio document", () => {
    const paste = vi.fn();
    const rendered = renderHarness({ copy: vi.fn(), cut: vi.fn(), paste });
    cleanup = rendered.cleanup;

    window.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));

    expect(paste).toHaveBeenCalledTimes(1);
  });

  it("keeps paste native inside an editable target", () => {
    const paste = vi.fn();
    const rendered = renderHarness({ copy: vi.fn(), cut: vi.fn(), paste });
    cleanup = rendered.cleanup;
    const input = document.createElement("input");
    document.body.appendChild(input);

    input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));

    expect(paste).not.toHaveBeenCalled();
    input.remove();
  });

  it("keeps clipboard events with an active automation selection", () => {
    const copy = vi.fn();
    const rendered = renderHarness({ copy, cut: vi.fn(), paste: vi.fn() });
    cleanup = rendered.cleanup;
    usePlayerStore.setState({
      automationSelection: {
        elementKey: "clip-1",
        target: "opacity",
        t0: 0,
        t1: 1,
        v0: 0,
        v1: 1,
      },
    });

    window.dispatchEvent(new ClipboardEvent("copy", { bubbles: true }));

    expect(copy).not.toHaveBeenCalled();
  });

  it("rebinds the preview window without duplicating listeners", () => {
    const paste = vi.fn();
    const rendered = renderHarness({ copy: vi.fn(), cut: vi.fn(), paste });
    cleanup = rendered.cleanup;
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);

    rendered.syncPreviewClipboard(iframe);
    rendered.syncPreviewClipboard(iframe);
    iframe.contentWindow?.dispatchEvent(new ClipboardEvent("paste", { bubbles: true }));

    expect(paste).toHaveBeenCalledTimes(1);
    iframe.remove();
  });
});
