// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FontFamilyField } from "./propertyPanelFont";
import { sortFontOptions } from "./propertyPanelHelpers";

vi.mock("./propertyPanelHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./propertyPanelHelpers")>();
  return { ...actual, sortFontOptions: vi.fn(actual.sortFontOptions) };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The font APIs are stubbed and every family is off the Google lists, so no test reaches the network.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({ fonts: url.includes("google") ? ["Roboto Slab"] : ["Arial"] }),
    })),
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("FontFamilyField flat trigger", () => {
  it("renders as a label/value row with a trailing dropdown caret, no boxed border", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(<FontFamilyField flat value="Georgia" importedFonts={[]} onCommit={vi.fn()} />);
    });
    const trigger = host.querySelector<HTMLButtonElement>('[data-flat-font-trigger="true"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.className).not.toContain("border-neutral-800");
    expect(host.textContent).toContain("Georgia");
    act(() => root.unmount());
  });
});

describe("FontFamilyField font list", () => {
  it("builds the list only while the dropdown is open", async () => {
    vi.mocked(sortFontOptions).mockClear();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = (value: string) =>
      root.render(<FontFamilyField flat value={value} importedFonts={[]} onCommit={vi.fn()} />);
    try {
      await act(async () => render("Arial"));
      // The font lists arrive and the value changes while the dropdown is closed, as during a drag.
      await act(async () => render("Georgia"));
      expect(sortFontOptions).not.toHaveBeenCalled();

      const trigger = host.querySelector<HTMLButtonElement>('[data-flat-font-trigger="true"]');
      await act(async () => trigger?.click());
      expect(sortFontOptions).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain("Roboto Slab");
      expect(document.head.querySelector('link[href*="fonts.googleapis.com"]')).toBeNull();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
