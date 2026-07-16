// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useToast } from "./useToast";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

let host: HTMLDivElement;
let root: Root;

function ToastHarness() {
  const { toasts, showToast } = useToast();

  return (
    <>
      <button type="button" onClick={() => showToast("Persistent error", "error")}>
        Add error
      </button>
      {[1, 2, 3, 4].map((number) => (
        <button key={number} type="button" onClick={() => showToast(`Info ${number}`, "info")}>
          Add info {number}
        </button>
      ))}
      <div data-testid="toasts">
        {toasts.map((toast) => (
          <span key={toast.id}>{toast.message}</span>
        ))}
      </div>
    </>
  );
}

function clickButton(label: string): void {
  const button = [...host.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeInstanceOf(HTMLButtonElement);
  if (button instanceof HTMLButtonElement) button.click();
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<ToastHarness />));
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

describe("useToast", () => {
  it("keeps an unresolved error after a burst exceeds the non-error cap", () => {
    act(() => {
      clickButton("Add error");
      clickButton("Add info 1");
      clickButton("Add info 2");
      clickButton("Add info 3");
      clickButton("Add info 4");
    });

    const visible = host.querySelector('[data-testid="toasts"]')?.textContent;
    expect(visible).toContain("Persistent error");
    expect(visible).not.toContain("Info 1");
    expect(visible).toContain("Info 2");
    expect(visible).toContain("Info 3");
    expect(visible).toContain("Info 4");
  });
});
