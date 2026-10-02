import { describe, expect, it } from "vitest";
import { accurate, bankable, comment, flipped, gate, QUARANTINED } from "./ratchet.mjs";
import { entry, score } from "./report.mjs";
import { scoreTeleport } from "./teleport.mjs";

const good = {
  tracking: 0.1,
  pressJump: 0,
  drop: 0,
  reload: 0,
  render: 0.02,
  undo: true,
  dropped: 0,
  controlDropped: 0,
  workMax: 3,
  frameP95: 20,
};
const run = (id, drop = 0) => ({
  id,
  tracking: { max: 0.1 },
  pressJump: 0,
  drop,
  reload: 0,
  render: 0.02,
  undo: { bytes: true, redoBytes: true, box: 0, redoBox: 0 },
  checks: { undo: true },
  smooth: { p95: 20, dropped: 0, workMax: 3, control: { dropped: 0 } },
  unsettled: [],
});
const baseline = (cases) => ({ cases });

describe("accurate", () => {
  it("ignores smoothness and a metric the baseline does not hold", () => {
    expect(accurate({ ...good, smooth: false, dropped: 4, workMax: 90 })).toBe(true);
    expect(accurate({ tracking: 0.1, drop: 0, reload: 0, undo: true })).toBe(true);
    expect(accurate({ ...good, pressJump: null })).toBe(true);
  });

  it("fails a px metric over the limit, a failed undo and an error", () => {
    expect(accurate({ ...good, drop: 0.51 })).toBe(false);
    expect(accurate({ ...good, pressJump: 0.51 })).toBe(false);
    expect(accurate({ ...good, unsettled: ["committed"] })).toBe(false);
    expect(accurate({ ...good, render: null, renderError: true })).toBe(false);
    expect(accurate({ ...good, undo: false })).toBe(false);
    expect(accurate({ ...good, teleport: false, teleportPx: null })).toBe(false);
    expect(accurate({ ...good, teleport: true })).toBe(true);
    expect(accurate({ ...good, text: false })).toBe(false);
    expect(accurate({ ...good, text: true })).toBe(true);
    expect(accurate({ error: true })).toBe(false);
    expect(accurate(undefined)).toBe(false);
  });
});

describe("quarantine", () => {
  const base = baseline({ a: good, b: good });
  const q = { a: "#1234" };

  it("measures a quarantined case but never fails the gate on it, while any other case still can", () => {
    const failing = [run("a", 9), run("a", 9), run("a", 9), run("b")];
    expect(gate(base, base, failing, q)).toMatchObject({ regressed: [], ok: true });
    expect(gate(base, base, failing, {})).toMatchObject({ regressed: ["a"], ok: false });
    const fresh = baseline({});
    expect(gate(fresh, fresh, [run("a"), run("b")], q)).toMatchObject({
      unbanked: ["b"],
      ok: false,
    });
    expect(
      gate(base, baseline({ a: good, b: good }), [run("a", 9), run("b")], q).overclaimed,
    ).toEqual([]);
  });

  it("lists every quarantined case with its fixer and each run's verdict, on every run", () => {
    const text = comment(gate(base, base, [run("a", 9), run("a"), run("a", 9), run("b")], q));
    expect(text).toContain("- a (fixed by #1234): fail / pass / fail, fails");
    expect(comment(gate(base, base, [run("b")], q))).toContain("- a (fixed by #1234): not run");
  });

  it("heads the comment with the accurate and smooth counts, smoothness never gating", () => {
    const smooth = (id, ok, drop = 0) => ({ ...run(id, drop), checks: { undo: true, smooth: ok } });
    // c is smooth but not accurate, so it is not counted.
    const g = gate(base, base, [smooth("a", false), smooth("b", true), smooth("c", true, 9)], {});
    expect(comment(g)).toContain("accurate 2 (base branch 2), smooth 1 of those");
    expect(g.headSmooth).toBeLessThanOrEqual(g.headPassing);
    expect(g.ok).toBe(true);
  });

  it("names a fixing PR for every quarantined id", () => {
    for (const fixer of Object.values(QUARANTINED)) expect(fixer).toMatch(/#\d+/);
  });
});

describe("gate", () => {
  const base = baseline({ a: good, b: good });

  it("banks for each case a run that agrees with its 2 of 3 verdict, not its first run", () => {
    const runs = [run("a", 9), run("b"), run("a"), run("b", 9), run("a"), run("b", 9)];
    const banked = bankable(runs);
    const g = gate(base, baseline({}), runs);
    expect(banked.map((r) => [r.id, accurate(entry(r))])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    const head = baseline(Object.fromEntries(banked.map((r) => [r.id, entry(r)])));
    const again = gate(base, head, runs);
    expect([again.unbanked, again.overclaimed]).toEqual([[], []]);
    expect(g.regressed).toEqual(["b"]);
  });

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

describe("teleport in the gate", () => {
  it("rejects a drag whose frames could not be measured, from scoring to the baseline entry", () => {
    const r = {
      tracking: { max: 0 },
      pressJump: 0,
      teleport: scoreTeleport("move", [{ t: 0, pointer: null, down: true }]),
      drop: 0,
      reload: 0,
      render: 0,
      undo: { bytes: true, redoBytes: true, box: 0, redoBox: 0 },
      undoTimeout: null,
      smooth: { intervals: [16], work: [2], control: { intervals: [16], work: [2] } },
      unsettled: [],
    };
    expect(accurate(entry(score({ id: "move-x" }, r)))).toBe(false);
    expect(accurate(entry(score({ id: "nudge-x" }, { ...r, teleport: null })))).toBe(true);
  });
});
