// @vitest-environment happy-dom

import React, { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsPanel } from "./ShortcutsPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function renderPanel(onRender = vi.fn()) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <Profiler id="shortcuts-panel" onRender={onRender}>
        <ShortcutsPanel
          disabled={false}
          duration={10}
          inPoint={null}
          outPoint={null}
          setInPoint={vi.fn()}
          setOutPoint={vi.fn()}
          onSeek={vi.fn()}
        />
      </Profiler>,
    );
  });

  const trigger = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Shortcuts and tools"]',
  )!;
  return { host, trigger, onRender };
}

function pressAndClick(target: HTMLElement): void {
  target.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }),
  );
  target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
}

function openPanel(trigger: HTMLButtonElement): void {
  act(() => pressAndClick(trigger));
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
}

describe("ShortcutsPanel", () => {
  it.each(["page", "button", "panel"] as const)(
    "closes with Escape from the %s-focused position",
    (focusPosition) => {
      const { host, trigger } = renderPanel();
      openPanel(trigger);

      let eventTarget: Document | HTMLElement;
      if (focusPosition === "page") {
        document.body.tabIndex = -1;
        document.body.focus();
        eventTarget = document;
        expect(document.activeElement).toBe(document.body);
      } else if (focusPosition === "button") {
        trigger.focus();
        eventTarget = trigger;
        expect(document.activeElement).toBe(trigger);
      } else {
        const panelInput = host.querySelector<HTMLInputElement>('[aria-label="Jump to frame"]')!;
        panelInput.focus();
        eventTarget = panelInput;
        expect(document.activeElement).toBe(panelInput);
      }

      act(() => {
        eventTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });

      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(host.querySelector('[aria-label="Jump to frame"]')).toBeNull();
    },
  );

  it("closes on capture-phase pointerdown even when its default is prevented", () => {
    const preventDefault = (event: Event) => event.preventDefault();
    document.addEventListener("pointerdown", preventDefault, true);
    const { host, trigger } = renderPanel();
    openPanel(trigger);
    const outside = document.createElement("div");
    document.body.append(outside);
    const pointerDown = new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });

    act(() => outside.dispatchEvent(pointerDown));

    document.removeEventListener("pointerdown", preventDefault, true);
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[aria-label="Jump to frame"]')).toBeNull();
  });

  it("does not close on a click inside the panel", () => {
    const { host, trigger } = renderPanel();
    openPanel(trigger);
    const panelInput = host.querySelector<HTMLInputElement>('[aria-label="Jump to frame"]')!;

    act(() => pressAndClick(panelInput));

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[aria-label="Jump to frame"]')).not.toBeNull();
  });

  it("toggles once per trigger click", () => {
    const { trigger } = renderPanel();

    act(() => pressAndClick(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => pressAndClick(trigger));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("does not re-render when Escape is pressed while closed", () => {
    const { trigger, onRender } = renderPanel();
    expect(onRender).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("connects the trigger to the dialog with aria-controls", () => {
    const { host, trigger } = renderPanel();
    openPanel(trigger);
    const panelId = trigger.getAttribute("aria-controls");
    const panel = panelId ? host.querySelector<HTMLElement>(`#${CSS.escape(panelId)}`) : null;

    expect(panelId).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("dialog");
    // Non-modal on purpose: focus is not trapped and the editor behind stays
    // operable, so aria-modal would lie to assistive tech about inertness.
    expect(panel?.getAttribute("aria-modal")).toBeNull();
    expect(panel?.id).toBe(panelId);
  });
});
