// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

// The react bindings dynamically import the player package root to register
// the custom element; stub it so the smoke test doesn't exercise the real
// player's iframe machinery in happy-dom.
vi.mock("@hyperframes/player", () => ({}));

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("App", () => {
  it("renders the player wired to the demo composition", async () => {
    await act(async () => root.render(<App />));
    const player = container.querySelector("hyperframes-player");
    expect(player).not.toBeNull();
    expect(player?.getAttribute("src")).toBe("/composition/index.html");
    expect(container.textContent).toContain("React playground");
  });

  it("reflects option toggles onto the player element", async () => {
    await act(async () => root.render(<App />));
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
    const mutedToggle = checkboxes.find((c) => c.parentElement?.textContent?.includes("Muted"));
    if (!mutedToggle) throw new Error("muted toggle not rendered");
    await act(async () => {
      mutedToggle.click();
    });
    expect(container.querySelector("hyperframes-player")?.hasAttribute("muted")).toBe(true);
  });
});
