// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TimelineGroupBusStrip } from "./TimelineGroupBusStrip";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderStrip(memberLabels: readonly string[]) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<TimelineGroupBusStrip memberLabels={memberLabels} />));
}

describe("TimelineGroupBusStrip", () => {
  // "vo-1 and vo-2", the designs' own phrasing. A comma list reads as data;
  // this line is a sentence about what the group holds.
  it("joins the member labels as a sentence", () => {
    renderStrip(["vo-1", "vo-2"]);
    expect(container.textContent).toContain("Holdsvo-1 and vo-2");
  });

  it("keeps the commas beyond two names", () => {
    renderStrip(["vo-1", "vo-2", "vo-3"]);
    expect(container.textContent).toContain("vo-1, vo-2 and vo-3");
  });

  it("says so when a group holds nothing yet", () => {
    renderStrip([]);
    expect(container.textContent).toContain("Holdsnothing yet");
  });

  // The volume slider and the level meter were removed with mute and solo.
  // `data-volume` is still honoured by the preview bus and the render — there
  // is just no control for it here, and no level read back out of the graph.
  it("offers no volume control and no meter", () => {
    renderStrip(["vo-1"]);
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).not.toMatch(/dB|Too loud/i);
  });
});
