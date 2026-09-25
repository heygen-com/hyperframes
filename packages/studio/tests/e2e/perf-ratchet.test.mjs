import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  browserMajor,
  checkCeilings,
  correlate,
  formatRow,
  lowerCeilings,
} from "./perf-ratchet.mjs";

describe("checkCeilings", () => {
  it("fails a counter that rose and names it with the rise", () => {
    const { passed, rows } = checkCeilings({ thumbnailRenders: 12 }, { thumbnailRenders: 20 });
    expect(passed).toBe(false);
    expect(formatRow(rows[0])).toBe("FAIL thumbnailRenders rose 12 -> 20 (+8, +67%)");
  });

  it("passes only at the ceiling", () => {
    expect(checkCeilings({ a: 5 }, { a: 5 }).passed).toBe(true);
  });

  it("fails a counter that fell until the improvement is banked", () => {
    const { passed, rows } = checkCeilings({ a: 5 }, { a: 3 });
    expect(passed).toBe(false);
    expect(formatRow(rows[0])).toMatch(/^FAIL a fell 5 -> 3: bank it by setting its ceiling to 3/);
  });

  it("fails a ceiling raised or removed against the base branch", () => {
    const { passed, rows } = checkCeilings({ a: 6 }, { a: 6 }, { a: 5, b: 2 });
    expect(passed).toBe(false);
    expect(rows.map((row) => row.status)).toEqual(["raised", "removed"]);
  });

  it("fails a gated counter the journey did not measure", () => {
    expect(checkCeilings({ reactCommits: 4 }, {}).passed).toBe(false);
    expect(checkCeilings({ reactCommits: 4 }, { reactCommits: Number.NaN }).passed).toBe(false);
  });

  it("refuses an empty ceiling set", () => {
    expect(() => checkCeilings({}, { a: 1 })).toThrow(/checks nothing/);
  });
});

describe("browserMajor", () => {
  it("reads Chrome's major version from either evidence shape", () => {
    expect(browserMajor({ browser: "HeadlessChrome/153.0.8010.52" })).toBe("153");
    expect(browserMajor({ environment: { browser: "Chrome/152.0.1.1" } })).toBe("152");
    expect(browserMajor({})).toBe(null);
  });
});

describe("lower", () => {
  const cli = fileURLToPath(new URL("./perf-ratchet.mjs", import.meta.url));
  const setup = (browser) => {
    const dir = mkdtempSync(join(tmpdir(), "perf-ratchet-"));
    const ceilings = join(dir, "ceilings.json");
    const evidence = join(dir, "evidence.json");
    writeFileSync(ceilings, JSON.stringify({ j: { browser: "153", counts: { a: 5 } } }));
    writeFileSync(evidence, JSON.stringify({ browser, workCounts: { a: 2 } }));
    return { ceilings, evidence };
  };

  it("lowers from evidence taken on the recorded browser", () => {
    const { ceilings, evidence } = setup("HeadlessChrome/153.0.1.1");
    execFileSync(process.execPath, [cli, "lower", ceilings, "j", evidence]);
    expect(JSON.parse(readFileSync(ceilings, "utf8")).j.counts).toEqual({ a: 2 });
  });

  it("refuses evidence from another Chrome", () => {
    const { ceilings, evidence } = setup("HeadlessChrome/152.0.1.1");
    expect(() =>
      execFileSync(process.execPath, [cli, "lower", ceilings, "j", evidence], { stdio: "pipe" }),
    ).toThrow(/Chrome 152/);
    expect(JSON.parse(readFileSync(ceilings, "utf8")).j.counts).toEqual({ a: 5 });
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

  it("does not gate a counter that wobbles even slightly within a variant", () => {
    const runs = [
      run("main", 900, { layouts: 100 }),
      run("main", 950, { layouts: 101 }),
      run("fix", 400, { layouts: 50 }),
      run("fix", 420, { layouts: 50 }),
    ];
    expect(correlate(runs)[0].gateable).toBe(false);
  });

  it("does not gate a counter that never moves", () => {
    const [row] = correlate([run("main", 900, { a: 1 }), run("fix", 400, { a: 1 })]);
    expect(row.gateable).toBe(false);
  });
});
