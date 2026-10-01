import { describe, expect, it } from "vitest";
import { accurate, flipped, gate } from "./ratchet.mjs";

const good = {
  tracking: 0.1,
  pressJump: 0,
  drop: 0,
  reload: 0,
  render: 0.02,
  undo: true,
  dropped: 0,
  controlDropped: 0,
  work: 3,
  frameP95: 20,
};
const run = (id, drop = 0) => ({
  id,
  pass: false,
  tracking: { max: 0.1 },
  pressJump: 0,
  drop,
  reload: 0,
  render: 0.02,
  undo: { bytes: true, redoBytes: true, box: 0, redoBox: 0 },
  checks: { undo: true },
  smooth: { p95: 20, dropped: 0, workP95: 3, control: { dropped: 0 } },
  unsettled: [],
});
const baseline = (cases) => ({ cases });

describe("accurate", () => {
  it("ignores smoothness and a metric the baseline does not hold", () => {
    expect(accurate({ ...good, dropped: 4, work: 90 })).toBe(true);
    expect(accurate({ tracking: 0.1, drop: 0, reload: 0, undo: true })).toBe(true);
    expect(accurate({ ...good, pressJump: null })).toBe(true);
  });

  it("fails a px metric over the limit, a failed undo and an error", () => {
    expect(accurate({ ...good, drop: 0.51 })).toBe(false);
    expect(accurate({ ...good, pressJump: 0.51 })).toBe(false);
    expect(accurate({ ...good, unsettled: ["committed"] })).toBe(false);
    expect(accurate({ ...good, render: null, renderError: true })).toBe(false);
    expect(accurate({ ...good, undo: false })).toBe(false);
    expect(accurate({ pass: false, error: true })).toBe(false);
    expect(accurate(undefined)).toBe(false);
  });
});

describe("gate", () => {
  const base = baseline({ a: good, b: good });

  it("re-runs every case whose verdict differs from the base branch, in either direction", () => {
    const mixed = baseline({ a: good, b: good, d: { ...good, drop: 9 } });
    expect(flipped(mixed, [run("a", 3), run("b"), run("c", 3), run("d")])).toEqual(["a", "d"]);
  });

  it("banks a newly passing case only when it passes 2 of 3 runs, and lists a lucky pass as unstable", () => {
    const before = baseline({ a: good, b: { ...good, drop: 9 } });
    const lucky = gate(before, before, [run("a"), run("b"), run("b", 9), run("b", 9)]);
    expect(lucky.newlyPassing).toEqual([]);
    expect(lucky.unbanked).toEqual([]);
    expect(lucky.unstable.map((u) => u.id)).toEqual(["b"]);
    expect(lucky.ok).toBe(true);
    const real = gate(before, before, [run("a"), run("b"), run("b"), run("b", 9)]);
    expect(real.unbanked).toEqual(["b"]);
    expect(real.ok).toBe(false);
  });

  it("fails a regression that fails 2 of 3 runs", () => {
    const g = gate(base, base, [run("a", 3), run("a", 3), run("a"), run("b")]);
    expect(g.regressed).toEqual(["a"]);
    expect(g.ok).toBe(false);
    expect(g.unstable.map((u) => u.id)).toEqual(["a"]);
  });

  it("passes a case that fails 1 of 3 runs but still lists it as unstable", () => {
    const g = gate(base, base, [run("a", 3), run("a"), run("a"), run("b")]);
    expect(g.regressed).toEqual([]);
    expect(g.unstable).toHaveLength(1);
    expect(g.unstable[0].runs[0]).toContain("drop 3");
    expect(g.ok).toBe(true);
  });

  it("fails a newly passing case until baseline.json banks it", () => {
    const before = baseline({ a: good, b: { ...good, drop: 9 } });
    expect(gate(before, before, [run("a"), run("b")]).unbanked).toEqual(["b"]);
    expect(gate(before, base, [run("a"), run("b")]).ok).toBe(true);
  });

  it("fails when baseline.json claims a pass the run does not reproduce", () => {
    const g = gate(baseline({}), baseline({ a: good }), [run("a", 3)]);
    expect(g.overclaimed).toEqual(["a"]);
    expect(g.ok).toBe(false);
  });

  it("fails when the passing count falls, as when a passing case leaves the grid", () => {
    const g = gate(base, base, [run("a")]);
    expect(g.missing).toEqual(["b"]);
    expect(g.reasons.join()).toContain("fell from 2 to 1");
  });
});
