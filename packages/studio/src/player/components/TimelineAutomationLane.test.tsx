// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { TimelineAutomationLane } from "./TimelineAutomationLane";
import { PAD_X } from "./automationLaneGeometry";
import { AUTOMATION_LANE_H } from "./automationLaneHeight";
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
  init: {
    clientX?: number;
    clientY?: number;
    button?: number;
    altKey?: boolean;
    shiftKey?: boolean;
  } = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: 0,
    clientY: 0,
    button: 0,
    pointerId: 1,
    altKey: false,
    shiftKey: false,
    ...init,
  });
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

/** The lane's own box, so pointer coordinates map to clip time and value. */
const BOX = { left: 100, top: 0, width: 400 + PAD * 2, height: AUTOMATION_LANE_H };

/** x for a clip time, y for a 0..1 unit height, in client coordinates. The
 *  6px inset and the height have to match the lane's own, or a point sits
 *  outside the grab radius and a press silently does nothing. */
const at = (t: number, unit: number) => ({
  clientX: BOX.left + PAD + (t / 4) * 400,
  clientY: BOX.top + 6 + (1 - unit) * (AUTOMATION_LANE_H - 12),
});

const mount = (automation: HfAutomation, over: Record<string, unknown> = {}) => {
  const base = laneProps({ automation, ...over });
  // Narrowed once here: laneProps types these as the prop signature, and every
  // assertion below reads the calls the lane made.
  const props = {
    ...base,
    onPreview: base.onPreview as ReturnType<typeof vi.fn>,
    onCommit: base.onCommit as ReturnType<typeof vi.fn>,
  };
  const { container } = render(<TimelineAutomationLane {...props} />);
  const svg = container.querySelector("svg")!;
  stubBox(svg, BOX);
  return { container, svg, props };
};

describe("TimelineAutomationLane modifiers", () => {
  it("bends a segment when it is Alt-dragged, and leaves the points where they were", () => {
    // `curve` was honoured everywhere it is read — drawn, sampled in preview,
    // baked into the render — with no gesture that could set it.
    const { svg, props } = mount(ramp);
    fire(svg, "pointerdown", { ...at(2, 0.5), altKey: true });
    fire(svg, "pointermove", { ...at(2, 0.85), altKey: true });
    const previewed = props.onPreview.mock.calls.at(-1)?.[0] as HfAutomation | undefined;
    const points = previewed?.lanes[0]?.points ?? [];
    expect(points[0]?.curve).toBeDefined();
    expect(points[0]?.curve).not.toBe(0);
    // The breakpoints themselves are untouched: only the shape between them moved.
    expect(points.map((p) => [p.t, p.v])).toEqual([
      [0, 1],
      [4, 0],
    ]);
  });

  it("straightens a segment on Alt-double-click", () => {
    const curved: HfAutomation = {
      version: 1,
      lanes: [
        {
          target: "volume",
          points: [
            { t: 0, v: 1, curve: 0.6 },
            { t: 4, v: 0 },
          ],
        },
      ],
    };
    const { svg, props } = mount(curved);
    fire(svg, "dblclick", { ...at(2, 0.5), altKey: true });
    const committed = props.onCommit.mock.calls.at(-1)?.[0] as HfAutomation | undefined;
    expect(committed?.lanes[0]?.points[0]?.curve).toBeUndefined();
  });

  it("locks a Shift-drag to one axis", () => {
    const { svg, props } = mount(ramp);
    // Grab the point at t=0, v=1 (top left) and pull mostly sideways.
    fire(svg, "pointerdown", at(0, 1));
    fire(svg, "pointermove", { ...at(2, 0.9), shiftKey: true });
    const points =
      (props.onPreview.mock.calls.at(-1)?.[0] as HfAutomation | undefined)?.lanes[0]?.points ?? [];
    const moved = points.find((p) => p.t > 0.5);
    expect(moved).toBeDefined();
    // Value held at exactly where the drag started, despite the vertical travel.
    expect(moved?.v).toBe(1);
  });

  it("snaps a dragged point to the beat grid", () => {
    // By eye, "on the beat" and "20 ms off the beat" look identical.
    const { svg, props } = mount(ramp, { snapTimes: [2] });
    fire(svg, "pointerdown", at(0, 1));
    fire(svg, "pointermove", at(2.02, 1));
    const points =
      (props.onPreview.mock.calls.at(-1)?.[0] as HfAutomation | undefined)?.lanes[0]?.points ?? [];
    expect(points.find((p) => p.t > 0.5)?.t).toBe(2);
  });

  it("ignores the grid while Alt is held", () => {
    const { svg, props } = mount(ramp, { snapTimes: [2] });
    fire(svg, "pointerdown", at(0, 1));
    fire(svg, "pointermove", { ...at(2.02, 1), altKey: true });
    const points =
      (props.onPreview.mock.calls.at(-1)?.[0] as HfAutomation | undefined)?.lanes[0]?.points ?? [];
    expect(points.find((p) => p.t > 0.5)?.t).toBeCloseTo(2.02, 2);
  });

  it("takes a second gesture in the same lane, not just the first", () => {
    // The panel had exactly this bug: one edit worked and every later one was
    // swallowed, because the live write skips the resync the next edit reads.
    const { svg, props } = mount(ramp);
    fire(svg, "pointerdown", at(0, 1));
    fire(svg, "pointermove", at(1, 0.8));
    fire(svg, "pointerup", at(1, 0.8));
    fire(svg, "pointerdown", at(4, 0));
    fire(svg, "pointermove", at(3, 0.4));
    const points =
      (props.onPreview.mock.calls.at(-1)?.[0] as HfAutomation | undefined)?.lanes[0]?.points ?? [];
    // Both ends moved: the first gesture's point is off t=0, the second's off t=4.
    expect(points.map((p) => Number(p.t.toFixed(2)))).toEqual([1, 3]);
  });

  it("types an exact value into a point", () => {
    // -6.0 dB is not a pixel you can find by dragging.
    const { container, svg, props } = mount(ramp);
    fire(svg, "dblclick", at(0, 1));
    const input = container.querySelector<HTMLInputElement>(".hf-automation-value");
    expect(input).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "0.25",
      );
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    fire(input!, "keydown", {});
    const key = new Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(key, { key: "Enter" });
    act(() => {
      input?.dispatchEvent(key);
    });
    const committed = props.onCommit.mock.calls.at(-1)?.[0] as HfAutomation | undefined;
    expect(committed?.lanes[0]?.points[0]?.v).toBe(0.25);
  });

  it("clamps a typed value to the parameter's range", () => {
    const { container, svg, props } = mount(ramp);
    fire(svg, "dblclick", at(0, 1));
    const input = container.querySelector<HTMLInputElement>(".hf-automation-value");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "99");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React listens for focusout, not blur — blur does not bubble.
    act(() => {
      input?.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    const committed = props.onCommit.mock.calls.at(-1)?.[0] as HfAutomation | undefined;
    expect(committed?.lanes[0]?.points[0]?.v).toBe(VOLUME_RANGE.max);
  });
});

describe("TimelineAutomationLane range selection", () => {
  it("drag on the background selects a range, snapped to the grid", () => {
    const onRangeSelect = vi.fn();
    const { svg } = mount(ramp, { snapTimes: [1], onRangeSelect });
    fire(svg, "pointerdown", at(0.98, 0.5)); // background: no point within grab radius
    fire(svg, "pointermove", at(3, 0.5));
    fire(svg, "pointerup", at(3, 0.5));
    const last = onRangeSelect.mock.calls.at(-1);
    expect(last?.[0]).toBe(1); // snapped to the beat
    expect(last?.[1]).toBeCloseTo(3, 1);
  });

  it("a sub-threshold click clears instead of selecting", () => {
    const onRangeSelect = vi.fn();
    const onRangeClear = vi.fn();
    const { svg } = mount(ramp, { onRangeSelect, onRangeClear });
    fire(svg, "pointerdown", at(1, 0.5));
    fire(svg, "pointerup", at(1.001, 0.5));
    expect(onRangeSelect).not.toHaveBeenCalled();
    expect(onRangeClear).toHaveBeenCalled();
  });

  it("draws the selection rect between its endpoints", () => {
    const { container } = mount(ramp, { rangeSelection: { t0: 1, t1: 3 } });
    const rect = container.querySelector("[data-automation-selection]");
    expect(rect).not.toBeNull();
    expect(Number(rect?.getAttribute("x"))).toBeCloseTo(PAD + 100, 0); // xOf(1) at 400px/4s
    expect(Number(rect?.getAttribute("width"))).toBeCloseTo(200, 0);
  });

  it("point drags still win over range selection", () => {
    const onRangeSelect = vi.fn();
    const { svg, props } = mount(ramp, { onRangeSelect });
    fire(svg, "pointerdown", at(0, 1)); // exactly on a point
    fire(svg, "pointermove", at(1, 0.8));
    fire(svg, "pointerup", at(1, 0.8));
    expect(onRangeSelect).not.toHaveBeenCalled();
    expect(props.onCommit).toHaveBeenCalled();
  });
});

describe("TimelineAutomationLane selection menu", () => {
  it("right-click inside the selection opens the shape menu", () => {
    const { container, svg } = mount(ramp, { rangeSelection: { t0: 1, t1: 3 } });
    fire(svg, "contextmenu", at(2, 0.5));
    expect(document.querySelector(".hf-automation-menu")).not.toBeNull();
    // The menu portals to document.body, outside `container` — dismiss it via
    // Escape before tearing down, or it leaks into the next test's DOM query.
    const escape = new Event("keydown", { bubbles: true, cancelable: true });
    Object.assign(escape, { key: "Escape" });
    act(() => {
      document.dispatchEvent(escape);
    });
    expect(document.querySelector(".hf-automation-menu")).toBeNull();
    act(() => container.remove());
  });

  it("inserting a swell replaces the range and commits once", () => {
    const { svg, props } = mount(ramp, { rangeSelection: { t0: 1, t1: 3 } });
    fire(svg, "contextmenu", at(2, 0.5));
    const swell = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".hf-automation-menu button"),
    ).find((b) => b.textContent === "Swell");
    expect(swell).toBeTruthy();
    act(() => swell?.click());
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    const points =
      (props.onCommit.mock.calls.at(-1)?.[0] as HfAutomation | undefined)?.lanes[0]?.points ?? [];
    expect(points.some((p) => p.t === 2 && p.v === 1)).toBe(true); // peak at range.max
  });

  it("right-click outside the selection does not open it", () => {
    const { svg } = mount(ramp, { rangeSelection: { t0: 1, t1: 3 } });
    fire(svg, "contextmenu", at(3.8, 0.5));
    expect(document.querySelector(".hf-automation-menu")).toBeNull();
  });
});
