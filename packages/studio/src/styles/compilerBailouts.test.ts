/**
 * The React Compiler bail-out ratchet (C1).
 *
 * `react({ compiler: true })` is silent about what it declines: a component the
 * compiler skips is emitted exactly as written, so losing memoization costs
 * nothing you can see in a diff, a build log or a test run. This is the alarm.
 *
 * Per file, not per repository, for the same reason the hex ratchet is: two
 * sweeps that touch the same file conflict on that file's line, which is when a
 * recount is worth doing. A single total would merge cleanly and be wrong.
 *
 * The baseline is never regenerated as a side effect of a normal run. A missing
 * one fails loudly, and rewriting it takes the named flag, so the number in git
 * is always one a human chose to accept. The scan itself lives in
 * `scripts/compiler-bailouts.mjs`, which `bun run compiler:bailouts` prints.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeSource,
  type Baseline,
  BASELINE_RELATIVE,
  isScanned,
  LOWER_COMMAND,
  scanTree,
  STUDIO_ROOT,
  toBaseline,
  toCounts,
  verdict,
  WRITE_FLAG,
} from "../../scripts/compiler-bailouts.mjs";

const BASELINE_PATH = path.join(STUDIO_ROOT, BASELINE_RELATIVE);

const REF_DURING_RENDER = `
import { useRef } from "react";
export function RefDuringRender({ n }: { n: number }) {
  const ref = useRef(0);
  return <div>{ref.current + n}</div>;
}
`;

const CLEAN = `
export function Clean({ n }: { n: number }) {
  return <div>{n * 2}</div>;
}
`;

const OPTED_OUT = `
export function OptedOut({ n }: { n: number }) {
  "use no memo";
  return <div>{n}</div>;
}
`;

function readBaseline(): Baseline | undefined {
  if (!existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

describe("bail-out scan", () => {
  it("reports a ref read during render, with the file and the cause", () => {
    const found = analyzeSource("src/RefDuringRender.tsx", REF_DURING_RENDER);

    expect(found.count).toBe(1);
    expect(found.causes).toEqual(["Cannot access refs during render"]);
  });

  it("reports nothing for a component the compiler can compile", () => {
    expect(analyzeSource("src/Clean.tsx", CLEAN)).toEqual({ count: 0, causes: [] });
  });

  it('counts a "use no memo" directive, which the compiler itself never reports', () => {
    // Measured, not assumed: with `panicThreshold: "all_errors"` the transform
    // returns zero errors for this source, because the directive is honoured
    // before any diagnostic is produced. Counting it from the text is the only
    // way it is visible, and without it the directive is a way past the gate.
    expect(analyzeSource("src/OptedOut.tsx", OPTED_OUT)).toEqual({
      count: 1,
      causes: ['"use no memo" directive'],
    });
  });

  it("leaves tests, stories, declarations and the setup file out of the scan", () => {
    expect(isScanned("src/App.tsx")).toBe(true);
    expect(isScanned("src/utils/timeline.ts")).toBe(true);
    expect(isScanned("src/App.test.tsx")).toBe(false);
    expect(isScanned("src/components/Button.stories.tsx")).toBe(false);
    expect(isScanned("src/vite-env.d.ts")).toBe(false);
    expect(isScanned("src/test-setup.ts")).toBe(false);
    expect(isScanned("scripts/compiler-bailouts.mjs")).toBe(false);
  });
});

describe("bail-out ratchet", () => {
  const baseline: Baseline = { total: 2, files: { "src/a.tsx": 2 } };

  it("fails when a file's count rises, naming the file and both numbers", () => {
    const message = verdict(new Map([["src/a.tsx", 3]]), baseline).join("\n");

    expect(message).toContain("src/a.tsx: 3 bail-outs, baseline 2");
    expect(message).toContain(LOWER_COMMAND);
  });

  it("passes when a count falls and says how to bank it", () => {
    const message = verdict(new Map([["src/a.tsx", 1]]), baseline).join("\n");

    expect(message).toContain("Bail-outs went down");
    expect(message).toContain(LOWER_COMMAND);
  });

  it("treats a file the baseline has never seen as a baseline of zero", () => {
    const empty: Baseline = { total: 0, files: {} };

    expect(verdict(new Map([["src/new.tsx", 0]]), empty)).toEqual([]);
    expect(verdict(new Map([["src/new.tsx", 1]]), empty).join("\n")).toContain(
      "src/new.tsx: 1 bail-outs, baseline 0",
    );
  });

  it("fails with the flag named when there is no baseline at all", () => {
    expect(verdict(new Map([["src/a.tsx", 0]]), undefined).join("\n")).toContain(`${WRITE_FLAG}=1`);
  });

  it("round-trips: a baseline written to disk accepts the scan that produced it", () => {
    const counts = new Map([
      ["src/b.tsx", 4],
      ["src/a.tsx", 2],
    ]);
    const scratch = path.join(mkdtempSync(path.join(tmpdir(), "bailouts-")), "baseline.json");

    writeFileSync(scratch, `${JSON.stringify(toBaseline(counts), null, 2)}\n`);
    const written = JSON.parse(readFileSync(scratch, "utf8")) as Baseline;

    expect(Object.keys(written.files)).toEqual(["src/a.tsx", "src/b.tsx"]);
    expect(written.total).toBe(6);
    expect(verdict(counts, written)).toEqual([]);
  });

  it("holds Studio at or below its committed React Compiler bail-out baseline", () => {
    const counts = toCounts(scanTree());
    if (process.env[WRITE_FLAG] === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(counts), null, 2)}\n`);
    }

    expect(verdict(counts, readBaseline())).toEqual([]);
  });
});
