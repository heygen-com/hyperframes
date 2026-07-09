// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PropertyPanelFlatFooter } from "./PropertyPanelFlatFooter";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderFooter(overrides: Partial<Parameters<typeof PropertyPanelFlatFooter>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<PropertyPanelFlatFooter {...overrides} />);
  });
  return { host, root };
}

describe("PropertyPanelFlatFooter", () => {
  it("renders the ask-agent affordance and fires onAskAgent on click", () => {
    const onAskAgent = vi.fn();
    const { host, root } = renderFooter({ onAskAgent });
    expect(host.textContent).toContain("Ask agent about this element");
    const askButton = host.querySelector<HTMLButtonElement>('[data-flat-footer-ask="true"]');
    act(() => askButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onAskAgent).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("shows the idle record affordance and toggles recording on click", () => {
    const onToggleRecording = vi.fn();
    const { host, root } = renderFooter({ recordingState: "idle", onToggleRecording });
    const recordButton = host.querySelector<HTMLButtonElement>('[data-flat-footer-record="true"]');
    expect(recordButton?.title).toBe("Record gesture (R)");
    act(() => recordButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onToggleRecording).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("shows the recording duration while recording", () => {
    const { host, root } = renderFooter({
      recordingState: "recording",
      recordingDuration: 2.4,
      onToggleRecording: vi.fn(),
    });
    const recordButton = host.querySelector<HTMLButtonElement>('[data-flat-footer-record="true"]');
    expect(recordButton?.title).toBe("Stop recording 2.4s");
    act(() => root.unmount());
  });
});
