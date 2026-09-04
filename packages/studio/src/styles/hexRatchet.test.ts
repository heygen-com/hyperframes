/**
 * The hex ratchet (R12, AE2).
 *
 * Every colour Studio draws should come from `theme.css`. Getting there is a
 * folder-by-folder sweep, so the rule cannot be "none" yet. It is "no more
 * than yesterday": a per-file baseline that only ever goes down.
 *
 * Per file, not per repository, on purpose. Two sweep PRs that touch the same
 * file conflict on that file's line, which is exactly when a recount is worth
 * doing; a single total would merge cleanly and be wrong.
 *
 * The baseline is never regenerated as a side effect of a normal run. A
 * missing one fails loudly, and rewriting it takes the named flag, so the
 * number in git is always one a human chose to accept.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listSourceFiles, REPO_ROOT, STYLES_DIR } from "./styleSources";

const BASELINE_PATH = path.join(STYLES_DIR, "hex-baseline.json");

const WRITE_FLAG = "HEX_BASELINE_WRITE";
const LOWER_COMMAND = `${WRITE_FLAG}=1 bunx vitest run src/styles/hexRatchet.test.ts`;

/**
 * A literal colour: `#abc`, `#aabbcc`, `#aabbccdd`, or a functional notation.
 * The test owns this regex, so the baseline is whatever this rule sees and
 * two different regexes cannot disagree about the count.
 */
const COLOR_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?)\(/gi;

/** Files whose whole job is to hold colour values. */
function isTokenSource(relative: string): boolean {
  return /styles\/(theme\.css|tailwind-preset\.shared\.js|tailwind-preset\.ts)$/.test(relative);
}

function isScanned(relative: string): boolean {
  if (isTokenSource(relative) || /\.test\.tsx?$/.test(relative)) return false;
  return /\.(tsx?|css)$/.test(relative);
}

function countColorLiterals(text: string): number {
  return [...text.matchAll(COLOR_LITERAL)].length;
}

/** Repository-relative path to colour-literal count, for every scanned file. */
function scan(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [file, text] of listSourceFiles(isScanned, REPO_ROOT)) {
    const count = countColorLiterals(text);
    if (count > 0) counts.set(file, count);
  }
  return counts;
}

interface Baseline {
  readonly total: number;
  readonly files: Readonly<Record<string, number>>;
}

function toBaseline(counts: ReadonlyMap<string, number>): Baseline {
  const files: Record<string, number> = {};
  let total = 0;
  for (const key of [...counts.keys()].sort()) {
    files[key] = counts.get(key) ?? 0;
    total += files[key];
  }
  return { total, files };
}

/** Every file whose count moved, split by direction. */
function compare(counts: ReadonlyMap<string, number>, baseline: Baseline) {
  const risen: string[] = [];
  const fallen: string[] = [];
  // A file missing from the baseline has a baseline of zero, so a rename
  // cannot smuggle its colours past the ratchet.
  for (const [file, count] of counts) {
    const allowed = baseline.files[file] ?? 0;
    if (count > allowed) risen.push(`${file}: ${count} colour literals, baseline ${allowed}`);
    if (count < allowed) fallen.push(`${file}: ${count}, baseline ${allowed}`);
  }
  for (const [file, allowed] of Object.entries(baseline.files)) {
    if (!counts.has(file)) fallen.push(`${file}: now 0, baseline ${allowed}`);
  }
  return { risen, fallen };
}

/**
 * What the author has to hear. A rise is a failure. A fall is fine, and is
 * reported with the command that banks it, because a baseline left high is a
 * budget the next change can spend.
 */
function verdict(counts: ReadonlyMap<string, number>, baseline: Baseline | undefined): string[] {
  if (baseline === undefined) {
    return [`src/styles/hex-baseline.json is missing. Write it with: ${LOWER_COMMAND}`];
  }
  const { risen, fallen } = compare(counts, baseline);
  if (risen.length > 0) {
    return [
      "Colour literals belong in src/styles/theme.css.",
      ...risen,
      `If these are unavoidable, lower is the only direction: ${LOWER_COMMAND}`,
    ];
  }
  if (fallen.length > 0) return [`Colour literals went down. Bank it: ${LOWER_COMMAND}`, ...fallen];
  return [];
}

function readBaseline(): Baseline | undefined {
  if (!existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

describe("colour literal counter", () => {
  it("counts a hex in a style object, in canvas code and in a stylesheet", () => {
    expect(countColorLiterals(`<div style={{ background: "#161618" }} />`)).toBe(1);
    expect(countColorLiterals(`context.fillStyle = "#090b0e";`)).toBe(1);
    expect(countColorLiterals(`.ring { box-shadow: 0 0 0 1px rgb(110 231 183); }`)).toBe(1);
    expect(countColorLiterals(`a { color: rgba(0, 0, 0, 0.5); border-color: hsl(0 0% 4%); }`)).toBe(
      2,
    );
  });

  it("does not mistake a fragment or an issue number for a colour", () => {
    // Known limit: an identifier that is exactly 3, 4, 6 or 8 hex characters
    // reads as a colour. The baseline absorbs it; the count only has to be
    // stable and monotone, not semantically perfect.
    expect(countColorLiterals(`href="#section-two" // see #12345`)).toBe(0);
  });

  it("leaves the token sources and the tests out of the scan", () => {
    expect(isScanned("packages/studio/src/styles/theme.css")).toBe(false);
    expect(isScanned("packages/studio/src/styles/tailwind-preset.shared.js")).toBe(false);
    expect(isScanned("packages/studio/src/styles/theme.test.ts")).toBe(false);
    expect(isScanned("packages/studio/src/components/ui/Button.tsx")).toBe(true);
  });
});

describe("hex ratchet", () => {
  const baseline: Baseline = { total: 2, files: { "a.tsx": 2 } };

  it("fails when a file's count rises, naming the file and both numbers", () => {
    // Covers AE2.
    const message = verdict(new Map([["a.tsx", 3]]), baseline).join("\n");

    expect(message).toContain("a.tsx: 3 colour literals, baseline 2");
    expect(message).toContain(LOWER_COMMAND);
  });

  it("passes when a count falls and says how to bank it", () => {
    const message = verdict(new Map([["a.tsx", 1]]), baseline).join("\n");

    expect(message).toContain("Colour literals went down");
    expect(message).toContain(LOWER_COMMAND);
  });

  it("treats a file the baseline has never seen as a baseline of zero", () => {
    const empty: Baseline = { total: 0, files: {} };

    expect(verdict(new Map([["new.tsx", 0]]), empty)).toEqual([]);
    expect(verdict(new Map([["new.tsx", 1]]), empty).join("\n")).toContain(
      "new.tsx: 1 colour literals, baseline 0",
    );
  });

  it("round-trips: a baseline written from a scan accepts that same scan", () => {
    const counts = new Map([
      ["b.css", 4],
      ["a.tsx", 2],
    ]);
    const written = toBaseline(counts);

    expect(Object.keys(written.files)).toEqual(["a.tsx", "b.css"]);
    expect(written.total).toBe(6);
    expect(verdict(counts, written)).toEqual([]);
  });

  it("fails with the flag named when there is no baseline at all", () => {
    expect(verdict(new Map([["a.tsx", 0]]), undefined).join("\n")).toContain(`${WRITE_FLAG}=1`);
  });

  it("holds Studio at or below its committed colour-literal baseline", () => {
    const counts = scan();
    if (process.env[WRITE_FLAG] === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(counts), null, 2)}\n`);
    }
    const committed = readBaseline();

    expect(verdict(counts, committed)).toEqual([]);
  });
});
