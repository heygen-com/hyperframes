// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installReactActEnvironment, makeSelection } from "../../hooks/domSelectionTestHarness";
import { CanvasContextMenu } from "./CanvasContextMenu";
import type { DomEditSelection } from "./domEditing";

installReactActEnvironment();

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderMenu(props: {
  selection: DomEditSelection;
  onApplyZIndex?: () => void;
  onDelete?: (selection: DomEditSelection) => void;
}) {
  root = createRoot(host);
  act(() => {
    root!.render(
      React.createElement(CanvasContextMenu, {
        x: 10,
        y: 10,
        selection: props.selection,
        onClose: () => {},
        onApplyZIndex: props.onApplyZIndex,
        onDelete: props.onDelete,
      }),
    );
  });
}

/** All menu buttons live in the portal under document.body. */
function menuButtons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

function hasDeleteItem(): boolean {
  return menuButtons().some((b) => b.textContent?.includes("Delete"));
}

function zOrderButtons(): HTMLButtonElement[] {
  return menuButtons().filter((b) => !b.textContent?.includes("Delete"));
}

describe("CanvasContextMenu — handler gating", () => {
  it("renders all four z-order items, a divider, and Delete when both handlers are present", () => {
    const el = document.createElement("div");
    el.id = "target";
    document.body.append(el);

    renderMenu({
      selection: makeSelection("Target", el),
      onApplyZIndex: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(zOrderButtons()).toHaveLength(4);
    expect(hasDeleteItem()).toBe(true);
    // The divider only appears between the two groups.
    expect(document.body.querySelector(".border-t")).not.toBeNull();
  });

  it("hides every item and does NOT render the menu when no handlers are present", () => {
    const el = document.createElement("div");
    el.id = "target";
    // A z-index that a stray optimistic write would clobber — assert it is
    // untouched, since the menu must not mutate the DOM without a persist path.
    el.style.zIndex = "3";
    document.body.append(el);

    renderMenu({ selection: makeSelection("Target", el) });

    // No menu opened at all — no buttons, no dead-end items, no DOM mutation.
    expect(menuButtons()).toHaveLength(0);
    expect(document.body.querySelector(".fixed.z-50")).toBeNull();
    expect(el.style.zIndex).toBe("3");
  });

  it("shows only the z-order items (no Delete, no divider) when onDelete is absent", () => {
    const el = document.createElement("div");
    el.id = "target";
    document.body.append(el);

    renderMenu({ selection: makeSelection("Target", el), onApplyZIndex: vi.fn() });

    expect(zOrderButtons()).toHaveLength(4);
    expect(hasDeleteItem()).toBe(false);
    expect(document.body.querySelector(".border-t")).toBeNull();
  });

  it("shows only Delete (no z-order items, no divider) when onApplyZIndex is absent", () => {
    const el = document.createElement("div");
    el.id = "target";
    document.body.append(el);

    renderMenu({ selection: makeSelection("Target", el), onDelete: vi.fn() });

    expect(zOrderButtons()).toHaveLength(0);
    expect(hasDeleteItem()).toBe(true);
    expect(document.body.querySelector(".border-t")).toBeNull();
  });
});
