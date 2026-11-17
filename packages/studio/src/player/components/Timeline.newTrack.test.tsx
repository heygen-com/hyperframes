// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { normalizeToZones } from "./timelineZones";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, borderBoxSize: [{ inlineSize: 900, blockSize: 400 }] } as never],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

const originalResizeObserver = globalThis.ResizeObserver;
const sizes = ["clientWidth", "clientHeight"] as const;
const originals = sizes.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));

beforeAll(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 900,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 400,
  });
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  sizes.forEach((name, i) => {
    const original = originals[i];
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
  });
  document.body.innerHTML = "";
});

const clip = (id: string, track: number, start = 0): TimelineElement => ({
  id,
  label: id,
  tag: "div",
  start,
  duration: 5,
  track,
});

async function settleUntil(ready: () => boolean) {
  for (let i = 0; i < 60 && !ready(); i++)
    await act(async () => new Promise<void>((done) => requestAnimationFrame(() => done())));
}

/** Mounts the timeline on `first`, then shows `next`; returns which of `kept` got a new DOM node. */
async function remountedAfter(first: TimelineElement[], next: TimelineElement[], kept: string[]) {
  const [{ Timeline }, { usePlayerStore }] = await Promise.all([
    import("./Timeline"),
    import("../store/playerStore"),
  ]);
  usePlayerStore.setState({ duration: 60, timelineReady: true, elements: normalizeToZones(first) });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const node = (id: string) => host.querySelector<HTMLElement>(`[data-el-id="${id}"]`);
  try {
    await act(async () => root.render(React.createElement(Timeline)));
    await settleUntil(() => kept.every((id) => node(id)));
    const before = new Map(kept.map((id) => [id, node(id)]));
    expect([...before.values()].every(Boolean)).toBe(true);
    await act(async () => usePlayerStore.setState({ elements: normalizeToZones(next) }));
    await settleUntil(() => next.every(({ id }) => node(id)));
    return kept.filter((id) => node(id) !== before.get(id));
  } finally {
    act(() => root.unmount());
    usePlayerStore.getState().reset();
  }
}

// An agent edit that adds a track re-zones every lane below it (normalizeToZones), shifting each clip's display
// track by one. On a long film that remounted the whole timeline in one frame. The 30 s budget matches
// Timeline.virtualization.test.
it(
  "adding a track above the others keeps every existing clip mounted",
  { timeout: 30_000 },
  async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const authored = ids.map((id, i) => clip(id, i + 1));
    expect(await remountedAfter(authored, [clip("new", 0), ...authored], ids)).toEqual([]);
  },
);

it(
  "deleting a track's first clip keeps the rest of the timeline mounted",
  { timeout: 30_000 },
  async () => {
    const first = [clip("x1", 0, 0), clip("x2", 0, 10), clip("y", 1), clip("z", 2)];
    expect(await remountedAfter(first, first.slice(1), ["x2", "y", "z"])).toEqual([]);
  },
);
