import { describe, expect, it } from "vitest";
import { checkCeilings, correlate, formatRow, lowerCeilings } from "./perf-ratchet.mjs";

describe("checkCeilings", () => {
  it("fails a counter that rose and names it with the rise", () => {
    const { passed, rows } = checkCeilings({ thumbnailRenders: 12 }, { thumbnailRenders: 20 });
    expect(passed).toBe(false);
    expect(formatRow(rows[0])).toBe("FAIL thumbnailRenders rose 12 -> 20 (+8, +67%)");
  });

  it("passes at or below the ceiling and asks to lower it when below", () => {
    const { passed, rows } = checkCeilings({ a: 5, b: 5 }, { a: 5, b: 3 });
    expect(passed).toBe(true);
    expect(rows.map((row) => row.status)).toEqual(["at", "below"]);
  });

  it("fails a gated counter the journey did not measure", () => {
    expect(checkCeilings({ reactCommits: 4 }, {}).passed).toBe(false);
  });

  it("refuses an empty ceiling set", () => {
    expect(() => checkCeilings({}, { a: 1 })).toThrow(/checks nothing/);
  });
});

describe("lowerCeilings", () => {
  it("only ever lowers", () => {
    expect(lowerCeilings({ a: 10, b: 10, c: 10 }, { a: 7, b: 12 })).toEqual({ a: 7, b: 10, c: 10 });
  });
});

describe("correlate", () => {
  const run = (variant, wallMs, counts) => ({ variant, wallMs, counts });

  it("gates a counter that repeats within a variant and moves with wall-clock", () => {
    const runs = [
      run("main", 900, { renders: 20, noisy: 3 }),
      run("main", 950, { renders: 20, noisy: 9 }),
      run("fix", 400, { renders: 12, noisy: 5 }),
      run("fix", 420, { renders: 12, noisy: 4 }),
    ];
    const byCounter = Object.fromEntries(correlate(runs).map((row) => [row.counter, row]));
    expect(byCounter.renders.gateable).toBe(true);
    expect(byCounter.noisy.gateable).toBe(false);
  });

  it("does not gate a counter that never moves", () => {
    const [row] = correlate([run("main", 900, { a: 1 }), run("fix", 400, { a: 1 })]);
    expect(row.gateable).toBe(false);
  });
});
