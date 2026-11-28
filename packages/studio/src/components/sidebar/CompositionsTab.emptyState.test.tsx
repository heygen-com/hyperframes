// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDockLayoutStore } from "../dock/dockLayoutStore";
import { mountCompositionsTab } from "./compositionsTabTestUtils";

function nudgeButton(host: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Browse starter scenes",
  );
}

describe("CompositionsTab empty state", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tells a new user what a composition is and opens the catalog", () => {
    const activatePanel = vi.spyOn(useDockLayoutStore.getState(), "activatePanel");
    const host = mountCompositionsTab({ compositions: [] });

    expect(host.textContent).toContain(
      "No compositions yet: a composition is an HTML scene in your project",
    );
    const button = nudgeButton(host);
    expect(button).toBeDefined();
    // A native button is keyboard-focusable and activatable by default.
    expect(button?.type).toBe("button");
    expect(button?.tabIndex).toBe(0);

    act(() => {
      button?.click();
    });
    expect(activatePanel).toHaveBeenCalledWith("catalog");
  });

  it("keeps the only card and shows the starter-scenes guidance under it", () => {
    const activatePanel = vi.spyOn(useDockLayoutStore.getState(), "activatePanel");
    const host = mountCompositionsTab({
      compositions: ["index.html"],
      masterCompositionPath: "index.html",
    });

    expect(host.querySelectorAll('[draggable="true"]')).toHaveLength(1);
    expect(host.textContent).toContain(
      "Only one composition so far: starter scenes are the fastest way to add more",
    );
    const button = nudgeButton(host);
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.tabIndex).toBe(0);

    act(() => {
      button?.click();
    });
    expect(activatePanel).toHaveBeenCalledWith("catalog");
  });

  it("shows no guidance once there are two or more compositions", () => {
    const host = mountCompositionsTab({
      compositions: ["index.html", "compositions/headline.html"],
      masterCompositionPath: "index.html",
    });

    expect(host.querySelectorAll('[draggable="true"]')).toHaveLength(2);
    expect(host.textContent).not.toContain("Only one composition so far");
    expect(host.textContent).not.toContain("No compositions yet");
    expect(nudgeButton(host)).toBeUndefined();
  });
});
