// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { TimelineAutomationLane } from "./TimelineAutomationLane";
import { PAD_X } from "./automationLaneGeometry";
import type { HfAudioFxChain } from "@hyperframes/core/audio-fx";
import {
  resolveAutomationRange,
  VOLUME_RANGE,
  type HfAutomation,
} from "@hyperframes/core/audio-automation";

const chain: HfAudioFxChain = {
  version: 1,
  nodes: [
    { type: "lowpass", id: "n1", enabled: true, params: {} },
    // No id: the panel has not touched it, so nothing can address it.
    { type: "peaking", enabled: true, params: {} },
    // Worklet-backed: no AudioParams to schedule.
    { type: "compressor", id: "n3", enabled: true, params: {} },
  ],
};

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderRerenderable(node: React.ReactElement): {
  container: HTMLElement;
  rerender(next: React.ReactElement): void;
} {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return {
    container: host,
    rerender: (next) => {
      act(() => {
        root.render(next);
      });
    },
  };
}

function render(node: React.ReactElement): { container: HTMLElement } {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { container: host };
}

/**
 * Mount inside a wrapper so propagation can be observed from a real ancestor.
 * A listener on React's own root node is no test of it: two native listeners on
 * one element both run regardless of stopPropagation.
 */
function renderNested(node: React.ReactElement): {
  container: HTMLElement;
  ancestor: HTMLElement;
} {
  const ancestor = document.createElement("div");
  const host = document.createElement("div");
  ancestor.append(host);
  document.body.append(ancestor);
  const root = createRoot(host);
  act(() => {
    root.render(node);
  });
  return { container: host, ancestor };
}

/** happy-dom has no pointer-event constructors wired to React's synthetic ones,
 *  so events are dispatched as plain typed events with the coordinates React
 *  reads off them. */
function fire(
  el: Element,
  type: string,
  init: { clientX?: number; clientY?: number; button?: number } = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: 0, clientY: 0, button: 0, pointerId: 1, ...init });
  act(() => {
    el.dispatchEvent(event);
  });
}

/** Slack the lane insets its drawing by, so an end point is not half clipped. */
const PAD = PAD_X;

const EMPTY: HfAutomation = { version: 1, lanes: [] };

const ramp: HfAutomation = {
  version: 1,
  lanes: [
    {
      target: "volume",
      points: [
        { t: 0, v: 1 },
        { t: 4, v: 0 },
      ],
    },
  ],
};

function laneProps(over: Partial<Parameters<typeof TimelineAutomationLane>[0]> = {}) {
  const target = over.target ?? "volume";
  return {
    duration: 4,
    widthPx: 400,
    leftPx: 100,
    topPx: 28,
    automation: EMPTY,
    accentColor: "#0af",
    playheadSec: null,
    onPreview: vi.fn(),
    onCommit: vi.fn(),
    ...over,
    target,
    range: over.range ?? resolveAutomationRange(target, chain) ?? VOLUME_RANGE,
  };
}

/** happy-dom gives every element a zero-size box; the lane maps pointers
 *  through it, so tests that click need a real one. */
function stubBox(el: Element, box: { left: number; top: number; width: number; height: number }) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("TimelineAutomationLane", () => {
  it("draws a point per breakpoint", () => {
    const { container } = render(<TimelineAutomationLane {...laneProps({ automation: ramp })} />);
    expect(container.querySelectorAll("circle").length).toBe(2);
  });

  it("draws a dimmed flat line when the lane is empty", () => {
    const { container } = render(<TimelineAutomationLane {...laneProps()} />);
    expect(container.querySelectorAll("circle").length).toBe(0);
    const path = container.querySelector("path");
    expect(Number(path?.getAttribute("opacity"))).toBeLessThan(0.5);
  });

  it("keeps an end point clear of the lane's edges", () => {
    // A point at t=0 drawn at x=0 is half outside the svg and unclickable; the
    // lane insets its drawing so both ends are whole.
    const ends: HfAutomation = {
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 1 },
            { t: 4, v: 0 },
          ],
        },
      ],
    };
    const { container } = render(<TimelineAutomationLane {...laneProps({ automation: ends })} />);
    const svg = container.querySelector("svg")!;
    const points = Array.from(container.querySelectorAll("[data-automation-point]"));
    const radius = Number(points[0]!.getAttribute("r"));
    const first = Number(points[0]!.getAttribute("cx"));
    const last = Number(points[1]!.getAttribute("cx"));
    const svgWidth = Number(svg.getAttribute("width"));
    expect(first).toBeGreaterThanOrEqual(radius);
    expect(last).toBeLessThanOrEqual(svgWidth - radius);
    // Wider than the clip by the padding on both sides, so clip time still
    // lines up with screen position.
    expect(svgWidth).toBe(400 + PAD * 2);
  });

  it("shows the parameter name in full, never clamped to a narrow gutter", () => {
    // A clip starting at zero leaves no gutter; the label used to be clamped to
    // 60px there and read "Low-pass ...".
    const { container } = render(
      <TimelineAutomationLane {...laneProps({ target: "fx.n1.frequency", leftPx: 0 })} />,
    );
    const name = container.querySelector<HTMLElement>(".hf-automation-name")!;
    expect(name.textContent).toBe("Low-pass · Cutoff");
    expect(name.className).not.toMatch(/truncate/);
    expect(name.style.maxWidth).toBe("");
  });

  it("names the parameter it draws, rather than offering a control to swap it", () => {
    const { container } = render(
      <TimelineAutomationLane {...laneProps({ target: "fx.n1.frequency" })} />,
    );
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector(".hf-automation-name")?.textContent).toMatch(/Cutoff/);
  });

  it("adds a point on double-click, at the value the pointer was at", () => {
    const onCommit = vi.fn();
    const { container } = render(<TimelineAutomationLane {...laneProps({ onCommit })} />);
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    // Half way across, and at the very top of the lane => t=2, v=1.
    fire(svg, "dblclick", { clientX: PAD + 200, clientY: 6 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    const lane = onCommit.mock.calls[0][0].lanes[0];
    expect(lane.target).toBe("volume");
    // Seeded at 0 so the envelope has somewhere to come from.
    expect(lane.points.length).toBe(2);
    expect(lane.points[1].t).toBeCloseTo(2, 5);
    expect(lane.points[1].v).toBeCloseTo(1, 2);
  });

  it("previews while dragging and persists once on release", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const { container } = render(
      <TimelineAutomationLane {...laneProps({ automation: ramp, onPreview, onCommit })} />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    // Grab the first point, at x=0 / top of the lane.
    fire(svg, "pointerdown", { clientX: 0, clientY: 6 });
    fire(svg, "pointermove", { clientX: 100, clientY: 42 });
    fire(svg, "pointermove", { clientX: 120, clientY: 40 });
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
    fire(svg, "pointerup", { clientX: 120, clientY: 40 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("moves the dragged point on screen without waiting for the prop", () => {
    // The live write skips the preview refresh on purpose, so `automation` does
    // not change under the pointer. Before the draft state existed the circle
    // stayed put and only the audio moved.
    const { container } = render(<TimelineAutomationLane {...laneProps({ automation: ramp })} />);
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    const cyBefore = Number(container.querySelectorAll("circle")[0]!.getAttribute("cy"));
    const cxBefore = Number(container.querySelectorAll("circle")[0]!.getAttribute("cx"));

    fire(svg, "pointerdown", { clientX: 0, clientY: 6 });
    fire(svg, "pointermove", { clientX: 160, clientY: 40 });

    const dragged = container.querySelectorAll("circle")[0]!;
    expect(Number(dragged.getAttribute("cy"))).toBeGreaterThan(cyBefore + 10);
    expect(Number(dragged.getAttribute("cx"))).toBeGreaterThan(cxBefore + 100);
  });

  it("keeps the dragged position after release, rather than snapping back", () => {
    const { container } = render(<TimelineAutomationLane {...laneProps({ automation: ramp })} />);
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    fire(svg, "pointerdown", { clientX: 0, clientY: 6 });
    fire(svg, "pointermove", { clientX: 160, clientY: 40 });
    const during = Number(container.querySelectorAll("circle")[0]!.getAttribute("cx"));
    fire(svg, "pointerup", { clientX: 160, clientY: 40 });
    expect(Number(container.querySelectorAll("circle")[0]!.getAttribute("cx"))).toBeCloseTo(
      during,
      5,
    );
  });

  it("follows the prop again once the store catches up", () => {
    const { container, rerender } = renderRerenderable(
      <TimelineAutomationLane {...laneProps({ automation: ramp })} />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    fire(svg, "pointerdown", { clientX: 0, clientY: 6 });
    fire(svg, "pointermove", { clientX: 160, clientY: 40 });
    fire(svg, "pointerup", { clientX: 160, clientY: 40 });
    // The persisted edit lands and the store hands back a different envelope;
    // the lane must defer to it instead of holding the stale draft forever.
    const persisted: HfAutomation = {
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 3, v: 0.25 }] }],
    };
    rerender(<TimelineAutomationLane {...laneProps({ automation: persisted })} />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(1);
    expect(Number(circles[0]!.getAttribute("cx"))).toBeCloseTo(PAD + 300, 0);
  });

  it("keeps lane order when editing, so the view does not switch parameters", () => {
    // The displayed lane defaults to the first one. Moving the edited lane to
    // the end of the list swapped the lane out from under the pointer on the
    // first edit — a 4-point filter sweep became a 2-point one mid-gesture.
    const onCommit = vi.fn();
    const two: HfAutomation = {
      version: 1,
      lanes: [
        {
          target: "fx.n1.frequency",
          points: [
            { t: 0, v: 400 },
            { t: 4, v: 8000 },
          ],
        },
        { target: "volume", points: [{ t: 0, v: 1 }] },
      ],
    };
    const { container } = render(
      <TimelineAutomationLane
        {...laneProps({ automation: two, target: "fx.n1.frequency", onCommit })}
      />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    fire(svg, "dblclick", { clientX: 200, clientY: 20 });
    const next: HfAutomation = onCommit.mock.calls[0][0];
    expect(next.lanes.map((l) => l.target)).toEqual(["fx.n1.frequency", "volume"]);
    expect(next.lanes[0]!.points.length).toBe(3);
  });

  it("appends a lane that did not exist yet", () => {
    const onCommit = vi.fn();
    const only: HfAutomation = {
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 0, v: 1 }] }],
    };
    const { container } = render(
      <TimelineAutomationLane
        {...laneProps({ automation: only, target: "fx.n1.frequency", onCommit })}
      />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    fire(svg, "dblclick", { clientX: 200, clientY: 20 });
    expect(onCommit.mock.calls[0][0].lanes.map((l: { target: string }) => l.target)).toEqual([
      "volume",
      "fx.n1.frequency",
    ]);
  });

  it("removes a point on right-click", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <TimelineAutomationLane {...laneProps({ automation: ramp, onCommit })} />,
    );
    fire(container.querySelectorAll("circle")[0]!, "contextmenu");
    expect(onCommit.mock.calls[0][0].lanes[0].points.length).toBe(1);
  });

  it("drops the lane entirely once its last point is removed", () => {
    const onCommit = vi.fn();
    const single: HfAutomation = {
      version: 1,
      lanes: [{ target: "volume", points: [{ t: 1, v: 0.5 }] }],
    };
    const { container } = render(
      <TimelineAutomationLane {...laneProps({ automation: single, onCommit })} />,
    );
    fire(container.querySelector("circle")!, "contextmenu");
    expect(onCommit.mock.calls[0][0].lanes).toEqual([]);
  });

  it("writes nothing when read-only, and lets the press through to select", () => {
    const onCommit = vi.fn();
    const onPreview = vi.fn();
    const { container } = render(
      <TimelineAutomationLane
        {...laneProps({ automation: ramp, onCommit, onPreview, readOnly: true })}
      />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    fire(svg, "dblclick", { clientX: 200, clientY: 6 });
    fire(svg, "pointerdown", { clientX: 0, clientY: 6 });
    fire(svg, "pointermove", { clientX: 100, clientY: 42 });
    fire(container.querySelectorAll("circle")[0]!, "contextmenu");
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("selects the clip when pressed read-only, the only route to editing it", () => {
    // The lane sits below the clip bar, so the timeline's own selection handler
    // never sees this press. Without selecting here the lane could never be
    // made editable at all.
    const onSelect = vi.fn();
    const { container } = render(
      <TimelineAutomationLane {...laneProps({ automation: ramp, readOnly: true, onSelect })} />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    fire(svg, "pointerdown", { clientX: 40, clientY: 24 });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("owns a press it cannot act on too, so the timeline does not scrub under it", () => {
    const { container, ancestor } = renderNested(
      <TimelineAutomationLane {...laneProps({ automation: ramp, readOnly: true })} />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    let reachedAncestor = false;
    ancestor.addEventListener("pointerdown", () => {
      reachedAncestor = true;
    });
    fire(svg, "pointerdown", { clientX: 40, clientY: 24 });
    expect(reachedAncestor).toBe(false);
  });

  it("owns the press once live, so a double-click is not eaten by the timeline", () => {
    const { container, ancestor } = renderNested(
      <TimelineAutomationLane {...laneProps({ automation: ramp })} />,
    );
    const svg = container.querySelector("svg")!;
    stubBox(svg, { left: 0, top: 0, width: 400, height: 48 });
    let reachedAncestor = false;
    ancestor.addEventListener("pointerdown", () => {
      reachedAncestor = true;
    });
    fire(svg, "pointerdown", { clientX: 200, clientY: 24 });
    expect(reachedAncestor).toBe(false);
  });

  it("maps a log-read knob so its geometric middle sits mid-lane", () => {
    const sweep: HfAutomation = {
      version: 1,
      lanes: [
        {
          target: "fx.n1.frequency",
          points: [
            { t: 0, v: 100 },
            { t: 4, v: 20000 },
          ],
        },
      ],
    };
    const { container } = render(
      <TimelineAutomationLane {...laneProps({ automation: sweep, target: "fx.n1.frequency" })} />,
    );
    const circles = container.querySelectorAll("circle");
    // 100 Hz is the range floor and 20 kHz its ceiling, so the two points sit at
    // the lane's bottom and top.
    const ys = Array.from(circles).map((c) => Number(c.getAttribute("cy")));
    expect(Math.max(...ys)).toBeGreaterThan(Math.min(...ys) + 30);
  });
});
