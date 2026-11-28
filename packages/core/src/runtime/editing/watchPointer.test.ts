import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_POINT_STACK, type EditingElementHit } from "../editingElement";

const under = vi.hoisted(() => ({
  answer: { target: null, stack: [] } as { target: unknown; stack: unknown[] },
  asked: [] as Array<[number, number]>,
}));
vi.mock("../editingTargets", () => ({
  pointerTargetsAt: (x: number, y: number) => {
    under.asked.push([x, y]);
    return under.answer;
  },
}));

import {
  MAX_POINTER_WATCHERS,
  parseWatchPointer,
  pointerEvent,
  stopWatchingPointer,
  watchPointer,
} from "./watchPointer";

const hit = (handle: string, x = 0): EditingElementHit => ({
  handle,
  tag: "h1",
  rect: { x, y: 0, width: 10, height: 10 },
});
const TITLE = hit("0123456789abcdef:1");
const SUB = hit("0123456789abcdef:2");
const answer = (target: EditingElementHit | null) => ({ target, stack: target ? [target] : [] });

describe("parseWatchPointer", () => {
  it("takes a point in fractions, and a null point as the stop", () => {
    expect(parseWatchPointer({ point: { x: 0.5, y: 0.25 } })).toEqual({
      point: { x: 0.5, y: 0.25 },
    });
    expect(parseWatchPointer({ point: null })).toEqual({ point: null });
  });

  it("refuses a missing or malformed point and an extra field", () => {
    for (const params of [
      {},
      { point: { x: 1 } },
      { point: { x: "1", y: 0 } },
      { point: { x: Number.NaN, y: 0 } },
      { point: { x: 0, y: 0, z: 0 } },
      { point: null, extra: 1 },
    ])
      expect(parseWatchPointer(params)).toBeNull();
  });
});

describe("pointerEvent", () => {
  const push = (over: Record<string, unknown>) => ({
    v: 1,
    event: "pointer-targets",
    at: 1,
    ...answer(TITLE),
    ...over,
  });

  it("takes the frame's answer, and no target as null", () => {
    expect(pointerEvent(push({}), 1)).toEqual({ at: 1, ...answer(TITLE) });
    expect(pointerEvent(push(answer(null)), 1)).toEqual({ at: 1, ...answer(null) });
  });

  it("drops a push with a field it does not allow, at any level", () => {
    for (const bad of [
      push({ extra: 1 }),
      push({ v: 2 }),
      push({ event: "geometry" }),
      push({ at: Number.NaN }),
      push({ stack: Array(MAX_POINT_STACK + 1).fill(TITLE) }),
      push({ target: { ...TITLE, extra: 1 } }),
      push({ target: { ...TITLE, handle: "1" } }),
      push({ target: { ...TITLE, rect: { ...TITLE.rect, x: "0" } } }),
      push({ stack: [{ ...TITLE, tag: 1 }] }),
    ])
      expect(pointerEvent(bad, 1)).toBeNull();
  });
});

describe("watchPointer", () => {
  const frames = new Map<number, FrameRequestCallback>();
  let lastFrame = 0;
  const step = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const run of due) run(0);
  };
  const pushes = (port: MessagePort) => {
    const seen: unknown[] = [];
    port.onmessage = (event) => seen.push(event.data);
    return seen;
  };
  const settle = () => new Promise((done) => setTimeout(done, 0));

  afterEach(() => {
    stopWatchingPointer();
    vi.restoreAllMocks();
    frames.clear();
    under.answer = answer(null);
    under.asked.length = 0;
  });

  const setUp = () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((run) => {
      frames.set(++lastFrame, run);
      return lastFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => frames.delete(key));
    const { port1, port2 } = new MessageChannel();
    return { frame: port1, parent: port2 };
  };

  it("pushes the answer under the point, then only when it changes", async () => {
    const { frame, parent } = setUp();
    const seen = pushes(parent);
    under.answer = answer(TITLE);
    expect(watchPointer(frame, { point: { x: 0.5, y: 0.5 } }, 1)).toEqual({ watching: true });
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    step();
    step();
    await settle();
    expect(seen).toHaveLength(1);
    expect(under.asked).toEqual([
      [0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    // The film moves another element under a pointer that has not moved.
    under.answer = answer(SUB);
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(pointerEvent(seen[1], 1)).toEqual({ at: expect.any(Number), ...answer(SUB) });
    parent.close();
  });

  // Guards the cost: a frame nobody hovers must run no per-frame hit test.
  it("asks for no frame and hit-tests nothing unless a point is watched, and nothing after its stop", async () => {
    const { frame, parent } = setUp();
    const seen = pushes(parent);
    stopWatchingPointer();
    stopWatchingPointer(frame);
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    watchPointer(frame, { point: { x: 0.5, y: 0.5 } }, 1);
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    watchPointer(frame, { point: null }, 1);
    const asked = under.asked.length;
    for (let i = 0; i < 5; i++) step();
    document.dispatchEvent(new Event("visibilitychange"));
    step();
    expect(under.asked).toHaveLength(asked);
    expect(frames.size).toBe(0);
    parent.close();
  });

  it("checks a moved point at once, and stops on a null point", async () => {
    const { frame, parent } = setUp();
    const seen = pushes(parent);
    under.answer = answer(TITLE);
    watchPointer(frame, { point: { x: 0.1, y: 0.1 } }, 1);
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    watchPointer(frame, { point: { x: 0.2, y: 0.2 } }, 1);
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(watchPointer(frame, { point: null }, 1)).toEqual({ watching: false });
    expect(frames.size).toBe(0);
    parent.close();
  });

  it("checks nothing while the page is hidden, and resumes when it is shown", async () => {
    const { frame, parent } = setUp();
    const seen = pushes(parent);
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    under.answer = answer(TITLE);
    watchPointer(frame, { point: { x: 0.5, y: 0.5 } }, 1);
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    step();
    expect(frames.size).toBe(0);
    under.answer = answer(SUB);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    step();
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    parent.close();
  });

  it("refuses a port past the watcher cap, and still lets a watching port move its point", () => {
    const { frame, parent } = setUp();
    const others = Array.from({ length: MAX_POINTER_WATCHERS - 1 }, () => new MessageChannel());
    watchPointer(frame, { point: { x: 0, y: 0 } }, 1);
    for (const { port1 } of others) watchPointer(port1, { point: { x: 0, y: 0 } }, 1);
    const extra = new MessageChannel();
    expect(() => watchPointer(extra.port1, { point: { x: 0, y: 0 } }, 1)).toThrow(/at most/);
    expect(watchPointer(frame, { point: { x: 1, y: 1 } }, 1)).toEqual({ watching: true });
    for (const { port1, port2 } of [...others, extra]) {
      port1.close();
      port2.close();
    }
    parent.close();
  });
});
