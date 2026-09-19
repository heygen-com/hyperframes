// @vitest-environment happy-dom

/**
 * Tooltip a11y contract Base UI must not lose: focus opens it, Escape
 * dismisses it (WCAG 1.4.13), aria-describedby ties trigger to bubble (4.1.2).
 */
import React, { act } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanupMounted, mountHost } from "./mountHost.testHelpers";
import { Tooltip } from "./Tooltip";

afterEach(cleanupMounted);

function mount(): HTMLElement {
  const host = mountHost(
    <Tooltip label="Selection tool (V)" delay={0}>
      <button type="button" data-testid="trigger">
        V
      </button>
    </Tooltip>,
  );
  const trigger = host.querySelector<HTMLElement>('[data-testid="trigger"]');
  if (!trigger) throw new Error("trigger not rendered");
  return trigger;
}

/** Base UI opens and closes across a task, not synchronously. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Browsers send hover to the wrapper, never to a disabled control inside it. */
function hover(trigger: HTMLElement): void {
  const box = trigger.parentElement ?? trigger;
  act(() => {
    box.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false, composed: true }));
    box.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, composed: true }));
    box.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, composed: true }));
  });
}

function bubble(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="tooltip"]');
}

it("opens on focus and describes its trigger", async () => {
  const trigger = mount();

  expect(bubble()).toBeNull();
  act(() => trigger.focus());
  await settle();

  const tip = bubble();
  expect(tip?.textContent).toBe("Selection tool (V)");
  expect(trigger.getAttribute("aria-describedby")).toBe(tip?.id);
});

it("opens on pointer hover", async () => {
  const trigger = mount();

  hover(trigger);
  await settle();

  expect(bubble()?.textContent).toBe("Selection tool (V)");
});

it("closes on Escape and drops the description", async () => {
  const trigger = mount();
  act(() => trigger.focus());
  await settle();
  expect(bubble()).not.toBeNull();

  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
  });
  await settle();

  expect(bubble()).toBeNull();
  expect(trigger.getAttribute("aria-describedby")).toBeNull();
});

it("opens on hover over a disabled child", async () => {
  const host = mountHost(
    <Tooltip label="Rendering" delay={0}>
      <button type="button" disabled data-testid="off">
        Export
      </button>
    </Tooltip>,
  );
  const off = host.querySelector<HTMLElement>('[data-testid="off"]');
  if (!off) throw new Error("trigger not rendered");

  hover(off);
  await settle();

  expect(bubble()?.textContent).toBe("Rendering");
});

it("wraps its child in a box so a disabled child still gets hover", () => {
  const trigger = mount();

  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.parentElement?.tagName).toBe("SPAN");
  expect(trigger.parentElement?.parentElement?.parentElement).toBe(document.body);
});
