// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorField } from "./propertyPanelColor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ColorField flat trigger", () => {
  it("renders label and value inline with a small swatch, no boxed border", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<ColorField flat label="Color" value="rgb(255, 176, 32)" onCommit={vi.fn()} />);
    });
    const trigger = host.querySelector<HTMLButtonElement>('[data-flat-color-trigger="true"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.className).not.toContain("border-neutral-800");
    expect(host.textContent).toContain("Color");
    act(() => root.unmount());
  });
});
