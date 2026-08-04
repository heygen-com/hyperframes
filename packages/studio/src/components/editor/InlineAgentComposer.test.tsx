// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineAgentComposer, resolveComposerPosition } from "./InlineAgentComposer";
import type { OverlayRect } from "./domEditOverlayGeometry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function rect(partial: Partial<OverlayRect>): OverlayRect {
  return { left: 0, top: 0, width: 100, height: 40, editScaleX: 1, editScaleY: 1, ...partial };
}

function renderComposer(overrides: Partial<Parameters<typeof InlineAgentComposer>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <InlineAgentComposer
        selectionLabel="#title"
        rect={rect({})}
        canvas={{ width: 800, height: 600 }}
        runLabel="Claude Code"
        agentKind="claude"
        running={false}
        onRun={vi.fn()}
        onCopy={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />,
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

const CANVAS = { width: 800, height: 600 };

describe("resolveComposerPosition", () => {
  it("centers under the selection", () => {
    expect(resolveComposerPosition(rect({ left: 300, top: 100, width: 200 }), CANVAS, 112)).toEqual(
      {
        left: 220, // 300 + 100 - 180
        top: 150, // 100 + 40 + 10
      },
    );
  });

  it("flips above when the composer would fall off the bottom", () => {
    const position = resolveComposerPosition(rect({ top: 520 }), CANVAS, 112);
    expect(position.top).toBe(398); // 520 - 112 - 10
  });

  it("clamps horizontally inside the canvas", () => {
    expect(resolveComposerPosition(rect({ left: 780 }), CANVAS, 112).left).toBe(430);
    expect(resolveComposerPosition(rect({ left: -200 }), CANVAS, 112).left).toBe(10);
  });

  it("pins to the bottom when the element has no rect", () => {
    expect(resolveComposerPosition(null, CANVAS, 112)).toEqual({ left: 220, bottom: 10 });
  });
});

describe("InlineAgentComposer", () => {
  it("runs on Enter, clears the input, and reports the result inline", async () => {
    const onRun = vi.fn().mockResolvedValue({ ok: true, message: "Claude Code finished." });
    const { host, root } = renderComposer({ onRun });
    type(host, "  make the title red  ");

    const textarea = host.querySelector("textarea");
    await act(async () => {
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });

    expect(onRun).toHaveBeenCalledWith("make the title red");
    expect(textarea?.value).toBe("");
    expect(host.textContent).toContain("Claude Code finished.");
    act(() => root.unmount());
  });

  it("keeps the instruction and shows the failure when the agent errors", async () => {
    const onRun = vi.fn().mockResolvedValue({ ok: false, message: "Agent exited with code 1" });
    const { host, root } = renderComposer({ onRun });
    type(host, "break it");
    await act(async () => {
      buttonLabelled(host, "Run")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector("textarea")?.value).toBe("break it");
    expect(host.textContent).toContain("Agent exited with code 1");
    act(() => root.unmount());
  });

  it("falls back to copying when no agent CLI is installed", () => {
    const onCopy = vi.fn();
    const onRun = vi.fn();
    const { host, root } = renderComposer({ runLabel: null, onCopy, onRun });
    type(host, "make it pop");
    act(() => {
      buttonLabelled(host, "Copy prompt")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    expect(onCopy).toHaveBeenCalledWith("make it pop");
    expect(onRun).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("shows the harness mark and drags from the header", () => {
    const { host, root } = renderComposer({ agentKind: "claude" });
    const composer = host.querySelector<HTMLElement>("[data-inline-agent-composer]");
    expect(composer?.querySelector('svg[fill="#d97757"]')).toBeTruthy();

    const header = composer?.firstElementChild as HTMLElement;
    header.setPointerCapture = vi.fn();
    header.releasePointerCapture = vi.fn();
    act(() => {
      header.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100, button: 0 }),
      );
      header.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 140, clientY: 130 }),
      );
    });

    expect(composer?.style.translate).toBe("40px 30px");
    act(() => root.unmount());
  });

  it("locks input and both actions while the agent is running", () => {
    const { host, root } = renderComposer({ running: true });
    expect(host.querySelector("textarea")?.disabled).toBe(true);
    expect(buttonLabelled(host, "Running…")?.disabled).toBe(true);
    expect(host.textContent).toContain("Claude Code is editing…");
    act(() => root.unmount());
  });

  it("closes on Escape without bubbling the key to canvas hotkeys", () => {
    const onClose = vi.fn();
    const { host, root } = renderComposer({ onClose });
    const bubbled = vi.fn();
    document.addEventListener("keydown", bubbled);
    act(() => {
      host
        .querySelector("textarea")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    document.removeEventListener("keydown", bubbled);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(bubbled).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
