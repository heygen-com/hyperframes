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
  // Regression: the hero and the tile shared one bounded poster, so the frame
  // detail view — the sketch pass's only picture — showed a 240x135 capture
  // upscaled past 7x on a retina display, and body copy was unreadable.
  it("captures the focus hero at the composition's own dimensions", () => {
    const url = new URL(renderPoster("hero").src);

    expect(url.searchParams.get("output")).toBe("source");
    expect(url.pathname).toBe("/api/projects/demo/thumbnail/frames/01-hero.html");
  });

  it("leaves the contact-sheet tile on the route's bounded preview capture", () => {
    const url = new URL(renderPoster("tile").src);

    expect(url.searchParams.has("output")).toBe(false);
  });

  it("defaults to the tile surface", () => {
    expect(new URL(renderPoster().src).search).toBe(new URL(renderPoster("tile").src).search);
  });

  it("letterboxes only the hero, so a tile still fills its cell", () => {
    expect(renderPoster("hero").className).toContain("object-contain");
    expect(renderPoster("tile").className).toContain("object-cover");
  });
});
