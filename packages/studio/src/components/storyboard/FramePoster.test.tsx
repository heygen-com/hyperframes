// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FramePoster } from "./FramePoster";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => roots.splice(0).forEach((root) => root.unmount()));
  document.body.replaceChildren();
});

// A fresh host per render: several cases compare two surfaces side by side.
function renderPoster(surface?: "tile" | "hero"): HTMLImageElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <FramePoster
        projectId="demo"
        src="frames/01-hero.html"
        seconds={3}
        title="hero"
        surface={surface}
      />,
    );
  });
  const img = host.querySelector("img");
  if (!img) throw new Error("poster did not render an <img>");
  return img;
}

describe("FramePoster", () => {
  // Regression: the contact sheet stretched a 240x135 capture across a wide,
  // high-density card, making body copy, thin lines, and sprite details blurry.
  it.each([
    [undefined, "storyboard"],
    ["tile", "storyboard"],
    ["hero", "source"],
  ] as const)("captures the %s surface at %s density", (surface, output) => {
    const url = new URL(renderPoster(surface).src);

    expect(url.searchParams.get("output")).toBe(output);
    expect(url.pathname).toBe("/api/projects/demo/thumbnail/frames/01-hero.html");
  });

  it("defaults to the tile surface", () => {
    expect(renderPoster().className).toBe(renderPoster("tile").className);
  });

  it("letterboxes only the hero, so a tile still fills its cell", () => {
    expect(renderPoster("hero").className).toContain("object-contain");
    expect(renderPoster("tile").className).toContain("object-cover");
  });
});
