// @vitest-environment happy-dom
/**
 * The tooltip's accessibility contract, which moving to Base UI must not lose:
 *
 *  - it opens on focus as well as on pointer, because a keyboard user reaches a
 *    control by focusing it and never hovers it,
 *  - Escape dismisses it (WCAG 1.4.13),
 *  - the trigger points at the bubble with `aria-describedby` while it is open
 *    (WCAG 4.1.2). Base UI 1.7.0 does not wire this itself, which is why the
 *    wrapper controls the open state, and why this test exists at all.
 *
 * Position, flip and the portal are the library's and need real layout, so they
 * belong to the screenshot run, not to happy-dom.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Tooltip } from "./Tooltip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement } | null = null;

afterEach(() => {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

function mount(): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() =>
    root.render(
      <Tooltip label="Selection tool (V)" delay={0}>
        <button type="button" data-testid="trigger">
          V
        </button>
      </Tooltip>,
    ),
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

  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false, composed: true }));
    trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, composed: true }));
    trigger.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, composed: true }));
  });
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

it("puts the trigger props on the caller's own element", () => {
  // The trigger renders the child rather than wrapping it: a wrapper with
  // `display: contents` has no box for the library to position against.
  const trigger = mount();

  expect(trigger.tagName).toBe("BUTTON");
  expect(trigger.parentElement).toBe(mounted?.host);
});
