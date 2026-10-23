import { describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { createRazorSplitRefreshGate } from "./razorSplitRefreshGate";

const element = (id: string): TimelineElement => ({
  id,
  tag: "div",
  start: 0,
  duration: 4,
  track: 0,
});

function harness() {
  let elements: TimelineElement[] = [element("a")];
  const listeners = new Set<() => void>();
  const replays: Array<Record<string, unknown>> = [];
  const gate = createRazorSplitRefreshGate({
    getElements: () => elements,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replay: async (item) => {
      replays.push({ ...item });
    },
    timeoutMs: 20,
  });
  const notify = () => listeners.forEach((listener) => listener());
  const swap = (next: TimelineElement[]) => {
    elements = next;
    notify();
  };
  return { gate, notify, swap, replays };
}

describe("razorSplitRefreshGate", () => {
  it("lets clicks through while disarmed", () => {
    const { gate } = harness();
    expect(gate.isArmed()).toBe(false);
    expect(gate.offer({ mode: "single", track: 0, splitTime: 2 })).toBe(false);
  });

  it("queues a click and replays it when the elements change", async () => {
    const { gate, swap, replays } = harness();
    gate.arm();
    expect(gate.offer({ mode: "single", track: 0, splitTime: 3 })).toBe(true);
    swap([element("a"), element("b")]);
    await vi.waitFor(() => expect(replays).toEqual([{ mode: "single", track: 0, splitTime: 3 }]));
    expect(gate.isArmed()).toBe(false);
    // Disarmed after the drain: the store is fresh, clicks run directly again.
    expect(gate.offer({ mode: "single", track: 0, splitTime: 1 })).toBe(false);
  });

  it("ignores state changes that keep the same elements reference", () => {
    const { gate, notify, replays } = harness();
    gate.arm();
    gate.offer({ mode: "all", splitTime: 2 });
    notify();
    expect(replays).toEqual([]);
    expect(gate.isArmed()).toBe(true);
  });

  it("drains on the timeout when no refresh ever lands", async () => {
    const { gate, replays } = harness();
    gate.arm();
    gate.offer({ mode: "all", splitTime: 2 });
    await vi.waitFor(() => expect(replays).toEqual([{ mode: "all", splitTime: 2 }]));
    expect(gate.isArmed()).toBe(false);
  });

  it("replays queued cuts in order, one at a time", async () => {
    const running: string[] = [];
    const order: string[] = [];
    let elements: TimelineElement[] = [element("a")];
    const listeners = new Set<() => void>();
    let release: (() => void) | null = null;
    const gate = createRazorSplitRefreshGate({
      getElements: () => elements,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      replay: async (item) => {
        running.push(String(item.splitTime));
        // Only the first replay blocks, so the test can observe the queue
        // waiting for it before the second one starts.
        if (item.splitTime === 2) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        order.push(String(item.splitTime));
      },
      timeoutMs: 20,
    });
    gate.arm();
    gate.offer({ mode: "all", splitTime: 2 });
    gate.offer({ mode: "all", splitTime: 4 });
    elements = [element("a"), element("b")];
    listeners.forEach((listener) => listener());
    await vi.waitFor(() => expect(running).toEqual(["2"]));
    expect(order).toEqual([]);
    release?.();
    await vi.waitFor(() => expect(order).toEqual(["2", "4"]));
  });

  it("flushWithoutRefresh drains immediately without waiting for elements", async () => {
    const { gate, replays } = harness();
    gate.arm();
    gate.offer({ mode: "single", track: 1, splitTime: 1 });
    gate.flushWithoutRefresh();
    await vi.waitFor(() => expect(replays).toEqual([{ mode: "single", track: 1, splitTime: 1 }]));
  });

  it("dispose drops queued clicks and stops listening", () => {
    const { gate, swap, replays } = harness();
    gate.arm();
    gate.offer({ mode: "all", splitTime: 2 });
    gate.dispose();
    swap([element("b")]);
    expect(replays).toEqual([]);
    expect(gate.isArmed()).toBe(false);
  });
});
