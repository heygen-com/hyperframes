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
        agentIconUrl={null}
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

function pressEnter(host: HTMLElement) {
  act(() => {
    host
      .querySelector("textarea")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

const CANVAS = { width: 800, height: 600 };

describe("resolveComposerPosition", () => {
  it("centers under the selection", () => {
    expect(resolveComposerPosition(rect({ left: 300, top: 100, width: 200 }), CANVAS, 84)).toEqual({
      left: 240, // 300 + 100 - 160
      top: 150, // 100 + 40 + 10
    });
  });

  it("flips above when the composer would fall off the bottom", () => {
    expect(resolveComposerPosition(rect({ top: 540 }), CANVAS, 84).top).toBe(446); // 540 - 84 - 10
  });

  it("clamps horizontally inside the canvas", () => {
    expect(resolveComposerPosition(rect({ left: 780 }), CANVAS, 84).left).toBe(470);
    expect(resolveComposerPosition(rect({ left: -200 }), CANVAS, 84).left).toBe(10);
  });

  it("pins to the bottom when the element has no rect", () => {
    expect(resolveComposerPosition(null, CANVAS, 84)).toEqual({ left: 240, bottom: 10 });
  });
});

describe("InlineAgentComposer", () => {
  it("queues the run on Enter and clears the field for the next one", () => {
    const onRun = vi.fn();
    const { host, root } = renderComposer({ onRun });

    type(host, "  make the title red  ");
    pressEnter(host);
    expect(onRun).toHaveBeenCalledWith("make the title red");
    expect(host.querySelector("textarea")?.value).toBe("");

    type(host, "now round the corners");
    pressEnter(host);
    expect(onRun).toHaveBeenCalledTimes(2);
    expect(onRun).toHaveBeenLastCalledWith("now round the corners");
    act(() => root.unmount());
  });

  it("copies instead of running when no agent CLI is installed", () => {
    const onCopy = vi.fn();
    const onRun = vi.fn();
    const { host, root } = renderComposer({ runLabel: null, onCopy, onRun });

    type(host, "make it pop");
    pressEnter(host);
    expect(onCopy).toHaveBeenCalledWith("make it pop");
    expect(onRun).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("names the harness in the header and the element in the field", () => {
    const { host, root } = renderComposer({ selectionLabel: "Card" });
    const header = host.querySelector<HTMLElement>("[data-inline-agent-composer]")
      ?.firstElementChild;
    expect(header?.textContent).toContain("Claude Code");
    expect(header?.textContent).not.toContain("Card");
    expect(host.querySelector("textarea")?.placeholder).toBe("Describe a change to Card…");
    act(() => root.unmount());
  });

  it("falls back to the element name when no harness is installed", () => {
    const { host, root } = renderComposer({ runLabel: null, selectionLabel: "Card" });
    expect(host.querySelector("[data-inline-agent-composer]")?.firstElementChild?.textContent).toContain(
      "Card",
    );
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
