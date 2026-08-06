// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { AgentOverlayState } from "./AgentOverlayState";
import type { OverlayRect } from "./domEditOverlayGeometry";
import type { OverlayState } from "./overlayState";

function render(state: OverlayState, angle?: number) {
  const rect: OverlayRect = {
    left: 100,
    top: 80,
    width: 200,
    height: 60,
    editScaleX: 1,
    editScaleY: 1,
    angle,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(<AgentOverlayState state={state} rect={rect} toContainerStyle={(s) => s} />);
  });
  const surface = host.querySelector("[data-agent-overlay-state]") as HTMLElement;
  return {
    surface,
    treatment: surface.querySelector("div") as HTMLElement,
    badge: surface.querySelector("span") as HTMLElement,
    cleanup: () => act(() => root.unmount()),
  };
}

describe("AgentOverlayState", () => {
  it("turns the treatment with the element and leaves the badge upright", () => {
    const { surface, treatment, badge, cleanup } = render({ kind: "editing" }, 180);
    // A flipped element used to render its badge in mirror writing, because the
    // whole surface carried the rotation.
    expect(surface.style.transform).toBe("");
    expect(treatment.style.transform).toBe("rotate(180deg)");
    expect(treatment.contains(badge)).toBe(false);
    cleanup();
  });

  it("adds no transform at all when the element is not rotated", () => {
    const { treatment, cleanup } = render({ kind: "editing" });
    expect(treatment.style.transform).toBe("");
    cleanup();
  });

  it("labels itself from the state, and falls back to the kind", () => {
    const named = render({ kind: "editing", scope: "text", label: "Rewriting the headline" });
    expect(named.badge.textContent).toContain("Rewriting the headline");
    named.cleanup();

    const bare = render({ kind: "reading" });
    expect(bare.badge.textContent).toContain("Reading");
    bare.cleanup();
  });

  it("takes the accent a run asked for", () => {
    const { surface, cleanup } = render({ kind: "editing", accent: "#ff00ff" });
    expect(surface.style.getPropertyValue("--hf-overlay-tint")).toBe("#ff00ff");
    cleanup();
  });
});
