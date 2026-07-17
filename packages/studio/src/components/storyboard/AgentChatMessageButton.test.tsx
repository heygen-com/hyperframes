// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentChatMessageButton } from "./AgentChatMessageButton";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AgentChatMessageButton", () => {
  it("reports a successful copy and resets to an explicit re-copy action", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const onCopied = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<AgentChatMessageButton message="handoff" onCopied={onCopied} />);
    });

    const button = host.querySelector("button");
    if (!button) throw new Error("copy button not rendered");
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("handoff");
    expect(onCopied).toHaveBeenCalledOnce();
    expect(button.textContent).toBe("Copied — paste in your agent chat");

    act(() => vi.advanceTimersByTime(3000));
    expect(button.textContent).toBe("Copy again");
    act(() => root.unmount());
  });
});
