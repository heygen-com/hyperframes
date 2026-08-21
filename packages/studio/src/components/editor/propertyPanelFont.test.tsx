// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FontFamilyField } from "./propertyPanelFont";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FontFamilyField flat trigger", () => {
  it("renders as a label/value row with a trailing dropdown caret, no boxed border", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <FontFamilyField flat value="JetBrains Mono" importedFonts={[]} onCommit={vi.fn()} />,
      );
    });
    const trigger = host.querySelector<HTMLButtonElement>('[data-flat-font-trigger="true"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.className).not.toContain("border-neutral-800");
    expect(host.textContent).toContain("JetBrains Mono");
    act(() => root.unmount());
  });
});
