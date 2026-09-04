// @vitest-environment happy-dom
/**
 * KTD6 dismiss spike (regression guard half).
 *
 * Studio's canvas overlay calls `stopPropagation()` on its own bubble-phase
 * pointer handlers (DomEditOverlay: marquee start, shift-select, inline-text
 * start), which is why `useContextMenuDismiss` listens in the CAPTURE phase.
 * Before any menu moves onto Base UI, these tests pin the behaviors a shared
 * Menu has to keep over that overlay.
 *
 * Base UI registers its outside-press listeners on `document` with capture set
 * (floating-ui-react/hooks/useDismiss), so a bubble-phase `stopPropagation`
 * upstream cannot swallow them. That is the claim under test here.
 *
 * happy-dom has no layout, so nothing asserts on position: only on open/closed
 * state, the item that ran, and `document.activeElement`. The browser half of
 * the spike (scripts/menu-dismiss-spike.mjs) is the verdict over the real
 * overlay; this file is what keeps the verdict from rotting.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { SpikeMenu } from "./menuDismissSpikeMount";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { root: Root; host: HTMLElement } | null = null;

afterEach(() => {
  if (!mounted) return;
  const { root, host } = mounted;
  mounted = null;
  act(() => root.unmount());
  host.remove();
});

/**
 * The synthetic stand-in for DomEditOverlay: a pointer surface whose
 * bubble-phase `onPointerDown`/`onMouseDown` swallow the event, exactly as the
 * overlay's marquee and shift-select branches do. The menu inside it is the
 * same component the browser half mounts over the real overlay.
 */
function Harness({ activated }: { activated: string[] }): React.JSX.Element {
  const swallow = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div onPointerDown={swallow} onMouseDown={swallow}>
      <div data-testid="overlay" aria-label="Composition canvas">
        overlay
      </div>
      <SpikeMenu onActivate={(item) => activated.push(item)} />
    </div>
  );
}

/** Base UI moves focus into the popup one task after open, not synchronously. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function press(target: Element): void {
  // `composed` is what a real browser sets: without it the event never crosses
  // a shadow boundary and Base UI's document listener never sees it.
  const init = { bubbles: true, cancelable: true, composed: true };
  act(() => {
    target.dispatchEvent(new PointerEvent("pointerdown", init));
    target.dispatchEvent(new MouseEvent("mousedown", init));
  });
}

function key(k: string): void {
  const target = document.activeElement ?? document.body;
  const init = { key: k, bubbles: true, cancelable: true, composed: true };
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  });
}

function trigger(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="spike-menu-trigger"]');
  if (!el) throw new Error("trigger not rendered");
  return el;
}

function popup(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="spike-menu-popup"]');
}

function required(el: Element | null, what: string): Element {
  if (!el) throw new Error(`${what} not rendered`);
  return el;
}

async function openMenu(activated: string[] = []): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = { root, host };
  act(() => root.render(<Harness activated={activated} />));
  act(() => trigger().click());
  await settle();
  expect(popup()).not.toBeNull();
}

it("closes on an outside press that a parent stops in the bubble phase", async () => {
  await openMenu();

  // Witness: a bubble-phase document listener is the thing the overlay starves.
  // If it ever starts firing, the press stopped being swallowed and this test
  // would pass for a reason that says nothing about capture-phase dismissal.
  let sawBubblePress = false;
  const witness = () => {
    sawBubblePress = true;
  };
  document.addEventListener("pointerdown", witness);
  press(required(document.querySelector('[data-testid="overlay"]'), "overlay"));
  document.removeEventListener("pointerdown", witness);

  expect(sawBubblePress).toBe(false);
  expect(popup()).toBeNull();
});

it("closes on an outside press inside a shadow root", async () => {
  await openMenu();

  const shadowHost = document.createElement("div");
  document.body.append(shadowHost);
  const inner = document.createElement("button");
  shadowHost.attachShadow({ mode: "open" }).append(inner);
  press(inner);
  shadowHost.remove();

  expect(popup()).toBeNull();
});

// AE5.
it("activates the second item with ArrowDown twice then Enter, and closes", async () => {
  const activated: string[] = [];
  await openMenu(activated);

  key("ArrowDown");
  key("ArrowDown");
  key("Enter");

  expect(activated).toEqual(["second"]);
  expect(popup()).toBeNull();
});

it("returns focus to the trigger after Escape", async () => {
  await openMenu();

  key("Escape");
  await settle();

  expect(popup()).toBeNull();
  expect(document.activeElement).toBe(trigger());
});
