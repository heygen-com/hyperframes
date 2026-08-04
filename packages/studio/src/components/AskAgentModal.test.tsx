// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskAgentModal } from "./AskAgentModal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function renderModal(overrides: Partial<Parameters<typeof AskAgentModal>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <AskAgentModal selectionLabel="#title" onSubmit={vi.fn()} onClose={vi.fn()} {...overrides} />,
    );
  });
  return { host, root };
}

function type(host: HTMLElement, value: string) {
  const textarea = host.querySelector("textarea");
  act(() => {
    if (textarea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        value,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function buttonLabelled(host: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
}

describe("AskAgentModal", () => {
  it("offers only Copy prompt when no agent CLI is available", () => {
    const { host, root } = renderModal();
    expect(buttonLabelled(host, "Copy prompt")).toBeTruthy();
    expect(buttonLabelled(host, "Run")).toBeUndefined();
    act(() => root.unmount());
  });

  it("runs the agent with the typed instruction", () => {
    const onRun = vi.fn();
    const { host, root } = renderModal({ runLabel: "Claude Code", onRun });
    type(host, "  make the title red  ");
    act(() => {
      buttonLabelled(host, "Run Claude Code")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onRun).toHaveBeenCalledWith("make the title red");
    act(() => root.unmount());
  });

  it("disables both actions while the agent is running", () => {
    const onRun = vi.fn();
    const { host, root } = renderModal({ runLabel: "Codex", running: true, onRun });
    type(host, "tighten the timing");
    expect(buttonLabelled(host, "Running…")?.disabled).toBe(true);
    expect(buttonLabelled(host, "Copy prompt")?.disabled).toBe(true);
    act(() => root.unmount());
  });
});
