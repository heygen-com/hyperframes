// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CaptionOverlay } from "./CaptionOverlay";
import { useCaptionStore } from "../store";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

it("only schedules caption layout for messages from its preview", () => {
  const host = document.createElement("div");
  const preview = document.createElement("iframe");
  const foreign = document.createElement("iframe");
  document.body.append(host, preview, foreign);
  const root = createRoot(host);
  const schedule = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", schedule);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  useCaptionStore.getState().setEditMode(true);
  const send = (source: MessageEventSource | null) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { source, data: { source: "hf-preview" } }));
    });
  try {
    act(() => root.render(<CaptionOverlay iframeRef={{ current: preview }} />));
    schedule.mockClear();
    send(foreign.contentWindow);
    send(null);
    expect(schedule).not.toHaveBeenCalled();
    send(preview.contentWindow);
    expect(schedule).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    useCaptionStore.getState().reset();
    host.remove();
    preview.remove();
    foreign.remove();
    vi.unstubAllGlobals();
  }
});
