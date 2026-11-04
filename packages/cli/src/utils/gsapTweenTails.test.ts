// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { collectTweenRecords, findTweenTails, type TweenRecord } from "./gsapTweenTails.js";

const record = (start: number, end: number, overrides: Partial<TweenRecord> = {}): TweenRecord => ({
  timeline: "main",
  target: 0,
  label: "#word",
  properties: ["x"],
  start,
  end,
  ...overrides,
});

describe("findTweenTails", () => {
  it("flags a drift that ends 20 ms after the exit on the same property", () => {
    // The banner: enter, drift to x: -40 until 12.555 s, exit to x: 2200 from 12.335 s to 12.535 s.
    const tails = findTweenTails([record(11.855, 12.555), record(12.335, 12.535)]);
    expect(tails).toEqual([
      expect.objectContaining({
        properties: ["x"],
        earlier: { start: 11.855, end: 12.555 },
        later: { start: 12.335, end: 12.535 },
      }),
    ]);
  });

  it("leaves a slow drift that resumes long after a short move", () => {
    expect(findTweenTails([record(0, 4), record(1, 1.5)])).toEqual([]);
  });

  it("leaves tweens on other properties, other targets and other timelines", () => {
    const drift = record(11.855, 12.555);
    expect(findTweenTails([drift, record(12.335, 12.535, { properties: ["opacity"] })])).toEqual(
      [],
    );
    expect(findTweenTails([drift, record(12.335, 12.535, { target: 1 })])).toEqual([]);
    expect(findTweenTails([drift, record(12.335, 12.535, { timeline: "other" })])).toEqual([]);
  });

  it("leaves a later tween that ends after the earlier one", () => {
    expect(findTweenTails([record(0, 1), record(0.5, 1.2)])).toEqual([]);
  });
});

type FakeAnimation = {
  vars: Record<string, unknown>;
  parent: FakeAnimation | null;
  targets: () => unknown[];
  totalDuration: () => number;
  globalTime: (localTime: number) => number;
  getChildren?: () => FakeAnimation[];
};

function fakeTimeline(at: number, parent: FakeAnimation | null = null): FakeAnimation {
  const children: FakeAnimation[] = [];
  const timeline: FakeAnimation = {
    vars: {},
    parent,
    targets: () => [],
    totalDuration: () => 0,
    globalTime: (local) => at + local,
    getChildren: () =>
      children.flatMap((child) => (child.getChildren ? [child, ...child.getChildren()] : [child])),
  };
  return Object.assign(timeline, {
    add(child: FakeAnimation) {
      children.push(child);
      return child;
    },
  });
}

function fakeTween(
  parent: FakeAnimation & { add?: (child: FakeAnimation) => FakeAnimation },
  target: unknown,
  vars: Record<string, unknown>,
  start: number,
): FakeAnimation {
  const duration = Number(vars.duration);
  const tween: FakeAnimation = {
    vars,
    parent,
    targets: () => [target],
    totalDuration: () => duration,
    globalTime: (local) => parent.globalTime(start) + local,
  };
  return parent.add!(tween);
}

describe("collectTweenRecords", () => {
  afterEach(() => {
    delete (window as unknown as { __timelines?: unknown }).__timelines;
    document.body.innerHTML = "";
  });

  it("times each tween on its registered timeline and labels its target", () => {
    const word = document.body.appendChild(document.createElement("div"));
    word.className = "fx-bword";
    const main = fakeTimeline(100);
    const scene = fakeTimeline(110.4, main);
    (main as unknown as { add: (child: FakeAnimation) => void }).add(scene);
    fakeTween(scene, word, { x: -40, duration: 0.7, ease: "none" }, 1.455);
    fakeTween(scene, word, { x: 2200, duration: 0.2, ease: "expo.in" }, 1.935);
    fakeTween(scene, word, { x: 0, duration: 1, repeat: 2 }, 3);
    (window as unknown as { __timelines: Record<string, unknown> }).__timelines = { main, scene };

    const records = collectTweenRecords();
    expect(records.map(({ timeline, label, properties }) => [timeline, label, properties])).toEqual(
      [
        ["main", "div.fx-bword", ["x"]],
        ["main", "div.fx-bword", ["x"]],
      ],
    );
    expect(records[0]!.start).toBeCloseTo(11.855, 6);
    expect(records[0]!.end).toBeCloseTo(12.555, 6);
    expect(findTweenTails(records)).toHaveLength(1);
  });

  it("ignores rendering flags when finding shared tween properties", () => {
    const target = {};
    const main = fakeTimeline(0);
    fakeTween(main, target, { x: 200, duration: 1, force3D: false, autoRound: false }, 0);
    fakeTween(main, target, { opacity: 0.5, duration: 0.4, force3D: false, autoRound: false }, 0.5);
    (window as unknown as { __timelines: Record<string, unknown> }).__timelines = { main };

    expect(collectTweenRecords().map(({ properties }) => properties)).toEqual([["x"], ["opacity"]]);
    expect(findTweenTails(collectTweenRecords())).toEqual([]);
  });

  it("still reports a shared animated property when rendering flags are present", () => {
    const target = {};
    const main = fakeTimeline(0);
    fakeTween(main, target, { opacity: 1, duration: 1, force3D: false, autoRound: false }, 0);
    fakeTween(main, target, { opacity: 0.5, duration: 0.4, force3D: false, autoRound: false }, 0.5);
    (window as unknown as { __timelines: Record<string, unknown> }).__timelines = { main };

    expect(findTweenTails(collectTweenRecords())).toEqual([
      expect.objectContaining({ properties: ["opacity"] }),
    ]);
  });

  it("returns nothing when no timeline is registered", () => {
    expect(collectTweenRecords()).toEqual([]);
  });
});
