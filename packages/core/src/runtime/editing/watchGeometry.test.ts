import { afterEach, describe, expect, it, vi } from "vitest";
import { elementGeometry } from "../editingGeometry";
import { handleFor } from "../editingHandles";
import {
  geometryEvent,
  MAX_GEOMETRY_WATCHERS,
  MAX_WATCHED_GEOMETRY,
  parseWatchGeometry,
  stopWatchingGeometry,
  watchGeometry,
} from "./watchGeometry";

const H = "0123456789abcdef:1";

describe("parseWatchGeometry", () => {
  it("takes up to the cap of handles, and an empty list as the stop", () => {
    expect(parseWatchGeometry({ handles: [] })).toEqual({ handles: [] });
    const full = Array(MAX_WATCHED_GEOMETRY).fill(H);
    expect(parseWatchGeometry({ handles: full })).toEqual({ handles: full });
  });

  it("refuses an over-cap list, a non-handle and an extra field", () => {
    for (const params of [
      { handles: Array(MAX_WATCHED_GEOMETRY + 1).fill(H) },
      { handles: ["1"] },
      { handles: [1] },
      { handles: H },
      { handles: [H], extra: 1 },
      {},
    ])
      expect(parseWatchGeometry(params)).toBeNull();
  });
});

describe("geometryEvent", () => {
  const measured = () => {
    document.body.innerHTML = `<div id="box" data-hf-group><i></i></div>`;
    return elementGeometry([handleFor(document.getElementById("box")!)], undefined).elements[0]!;
  };

  it("takes what the frame measures, and a gone element as null", () => {
    const element = measured();
    const data = { v: 1, event: "geometry", at: 12.5, elements: [element, null] };
    expect(geometryEvent(data, 1)).toEqual({ at: 12.5, elements: [element, null] });
  });

  it("drops a push with a field it does not allow, at any level", () => {
    const element = measured();
    const push = (over: Record<string, unknown>, el: unknown = element) => ({
      v: 1,
      event: "geometry",
      at: 1,
      elements: [el],
      ...over,
    });
    for (const bad of [
      push({ extra: 1 }),
      push({ v: 2 }),
      push({ event: "key" }),
      push({ at: Number.NaN }),
      push({ elements: Array(MAX_WATCHED_GEOMETRY + 1).fill(null) }),
      push({}, { ...element, extra: 1 }),
      push({}, { ...element, rect: { ...element.rect, z: 0 } }),
      push({}, { ...element, rect: { ...element.rect, x: "0" } }),
      push({}, { ...element, visible: "yes" }),
      push({}, { ...element, clipPath: "x".repeat(2_001) }),
      push({}, { ...element, members: [{ ...element.rect, z: 0 }] }),
      push({}, { ...element, corners: { nw: { x: 0, y: 0 } } }),
      push({}, { ...element, source: { width: 1, height: 1, declaredWidth: null } }),
    ])
      expect(geometryEvent(bad, 1)).toBeNull();
  });
});

// jsdom has no ResizeObserver: this one reports each observed target after the frame's rAF callbacks, as browsers do.
const observed: Array<{ report: ResizeObserverCallback; targets: Set<Element> }> = [];
vi.stubGlobal(
  "ResizeObserver",
  class {
    entry = { report: (() => {}) as ResizeObserverCallback, targets: new Set<Element>() };
    constructor(report: ResizeObserverCallback) {
      this.entry.report = report;
      observed.push(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
    }
    unobserve(target: Element) {
      this.entry.targets.delete(target);
    }
  },
);

describe("watchGeometry", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let lastFrame = 0;
  let now = 0;
  const step = () => {
    now += 16;
    const due = [...frames.values()];
    frames.clear();
    for (const run of due) run(now);
    for (const { report, targets } of observed) if (targets.size) report([], {} as ResizeObserver);
  };
  const pushes = (port: MessagePort) => {
    const seen: unknown[] = [];
    port.onmessage = (event) => seen.push(event.data);
    return seen;
  };

  afterEach(() => {
    stopWatchingGeometry();
    vi.restoreAllMocks();
    frames.clear();
  });

  const setUp = () => {
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((run) => {
      frames.set(++lastFrame, run);
      return lastFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => frames.delete(key));
    document.body.innerHTML = `<div id="box"></div>`;
    const handle = handleFor(document.getElementById("box")!);
    const { port1, port2 } = new MessageChannel();
    return { handle, frame: port1, parent: port2 };
  };

  it("pushes the watched elements' geometry each animation frame, stamped on the shared clock", async () => {
    const { handle, frame, parent } = setUp();
    const seen = pushes(parent);
    expect(watchGeometry(frame, { handles: [handle, H] }, 1)).toEqual({ watching: 2 });
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    const [expected] = elementGeometry([handle], undefined).elements;
    expect(seen[1]).toEqual({
      v: 1,
      event: "geometry",
      at: performance.timeOrigin + 32,
      elements: [expected, null],
    });
    expect(geometryEvent(seen[1], 1)).not.toBeNull();
    parent.close();
  });

  it("refuses a port past the watcher cap, and still lets a watching port change its list", () => {
    const { handle, frame, parent } = setUp();
    const others = Array.from({ length: MAX_GEOMETRY_WATCHERS - 1 }, () => new MessageChannel());
    watchGeometry(frame, { handles: [handle] }, 1);
    for (const { port1 } of others) watchGeometry(port1, { handles: [handle] }, 1);
    const extra = new MessageChannel();
    expect(() => watchGeometry(extra.port1, { handles: [handle] }, 1)).toThrow(/at most/);
    expect(watchGeometry(frame, { handles: [handle, H] }, 1)).toEqual({ watching: 2 });
    for (const { port1, port2 } of [...others, extra]) {
      port1.close();
      port2.close();
    }
    parent.close();
  });

  it("drops a watch whose port throws, and keeps pushing to the rest", async () => {
    const { handle, frame, parent } = setUp();
    const seen = pushes(parent);
    const lost = {
      postMessage: () => {
        throw new Error("gone");
      },
    } as unknown as MessagePort;
    watchGeometry(lost, { handles: [handle] }, 1);
    watchGeometry(frame, { handles: [handle] }, 1);
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    stopWatchingGeometry(frame);
    expect(frames.size).toBe(0);
    parent.close();
  });

  it("keeps the loop running when a frame's measure throws", async () => {
    const { handle, frame, parent } = setUp();
    watchGeometry(frame, { handles: [handle] }, 1);
    const measure = vi.spyOn(window, "getComputedStyle").mockImplementationOnce(() => {
      throw new Error("detached");
    });
    step();
    await vi.waitFor(() => expect(frames.size).toBe(1));
    expect(measure).toHaveBeenCalled();
    parent.close();
  });

  it("measures after the frame renders, so a later rAF callback's change is what it reports", async () => {
    const { handle, frame, parent } = setUp();
    const seen = pushes(parent);
    const box = document.getElementById("box")!;
    watchGeometry(frame, { handles: [handle] }, 1);
    // A callback queued after the watch's, as Studio's or the runtime's own rAF work would be.
    requestAnimationFrame(() => box.style.setProperty("clip-path", "inset(2px)"));
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    const [element] = (seen[0] as { elements: Array<{ clipPath: string }> }).elements;
    expect(element.clipPath).toBe("inset(2px)");
    parent.close();
  });

  it("stops on an empty list, on the page hiding, and on the agent's stop", () => {
    const { handle, frame, parent } = setUp();
    const stops = [
      () => watchGeometry(frame, { handles: [] }, 1),
      () => window.dispatchEvent(new Event("pagehide")),
      () => stopWatchingGeometry(frame),
    ];
    const observing = () => observed.some(({ targets }) => targets.size > 0);
    for (const stop of stops) {
      watchGeometry(frame, { handles: [handle] }, 1);
      expect(frames.size).toBe(1);
      stop();
      expect(frames.size).toBe(0);
      // Stopped again between a frame's re-arm and its observer step: the observer lets go too.
      watchGeometry(frame, { handles: [handle] }, 1);
      for (const arm of [...frames.values()]) arm(now);
      frames.clear();
      expect(observing()).toBe(true);
      stop();
      expect(observing()).toBe(false);
    }
    parent.close();
  });
});
