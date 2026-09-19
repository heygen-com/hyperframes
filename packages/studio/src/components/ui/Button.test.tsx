// @vitest-environment happy-dom

// happy-dom has no CSS engine, so this pins the structure that makes the gap
// work (children are direct flex items of the gap-bearing button), not the
// computed pixels. The measured gap is verified in a real browser.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./Button";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(element: React.ReactNode): HTMLButtonElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
  const button = host.querySelector("button");
  if (!button) throw new Error("button did not render");
  return button;
}

describe("Button children layout", () => {
  it("lays label and kbd out as sibling flex items of the gap-bearing button", () => {
    const button = mount(
      <Button size="md">
        <span>Export</span>
        <kbd>⌘E</kbd>
      </Button>,
    );

    expect(button.classList.contains("inline-flex")).toBe(true);
    expect(button.classList.contains("gap-1.5")).toBe(true);
    expect(Array.from(button.children).map((child) => child.tagName)).toEqual(["SPAN", "KBD"]);
  });

  it("puts children next to the icon as direct flex items too", () => {
    const button = mount(
      <Button icon={<svg />}>
        <span>Export</span>
        <kbd>⌘E</kbd>
      </Button>,
    );

    expect(Array.from(button.children).map((child) => child.tagName)).toEqual([
      "SPAN",
      "SPAN",
      "KBD",
    ]);
  });
});
