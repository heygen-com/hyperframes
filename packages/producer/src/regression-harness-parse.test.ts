// Pure-function tests for `parseArgs()` in the regression harness. Pins the
// `--exclude-tags` comma-parsing contract that the values baked into
// `Dockerfile.test` and `packages/producer/package.json` test scripts depend
// on. When someone changes the parser (e.g. to space-separated or repeated
// flags) these tests + the invocation strings in the Dockerfile / package.json
// must move together.

import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegressionTempRoot, parseArgs } from "./regression-harness.js";

// parseArgs reads from index 2 onwards (node + script name are argv[0..1]).
const withProgram = (rest: string[]): string[] => ["node", "regression-harness.ts", ...rest];

describe("parseArgs() — --exclude-tags", () => {
  it("splits a single --exclude-tags argument on commas", () => {
    const opts = parseArgs(withProgram(["--exclude-tags", "transparency,field-signal-reproducer"]));
    expect(opts.excludeTags).toEqual(["transparency", "field-signal-reproducer"]);
  });

  it("accepts a single tag with no comma", () => {
    const opts = parseArgs(withProgram(["--exclude-tags", "transparency"]));
    expect(opts.excludeTags).toEqual(["transparency"]);
  });

  it("supports repeated --exclude-tags flags (accumulating)", () => {
    const opts = parseArgs(
      withProgram(["--exclude-tags", "transparency", "--exclude-tags", "field-signal-reproducer"]),
    );
    expect(opts.excludeTags).toEqual(["transparency", "field-signal-reproducer"]);
  });

  it("matches the values baked into Dockerfile.test ENTRYPOINT and package.json scripts", () => {
    // Pins the exact string the Dockerfile.test ENTRYPOINT + package.json
    // `test:regression*` scripts pass. If either invocation site changes to
    // whitespace-separated or another delimiter, this test fails and forces
    // an audit of the parser at the same time.
    const opts = parseArgs(
      withProgram([
        "--sequential",
        "--exclude-tags",
        "transparency,field-signal-reproducer",
        "hdr-regression",
      ]),
    );
    expect(opts.sequential).toBe(true);
    expect(opts.excludeTags).toEqual(["transparency", "field-signal-reproducer"]);
    expect(opts.testNames).toEqual(["hdr-regression"]);
  });

  it("defaults excludeTags to an empty array when the flag is absent", () => {
    const opts = parseArgs(withProgram([]));
    expect(opts.excludeTags).toEqual([]);
  });
});

describe("regression temporary roots", () => {
  it("isolates repeated suite runs and preserves the old predictable directory", () => {
    const parent = mkdtempSync(join(tmpdir(), "hf-root-test-"));
    try {
      const legacy = join(parent, "hyperframes-tests", "same-suite");
      mkdirSync(legacy, { recursive: true });
      const sentinel = join(legacy, "keep.txt");
      writeFileSync(sentinel, "unrelated data");
      const first = createRegressionTempRoot("same-suite", parent);
      const second = createRegressionTempRoot("same-suite", parent);
      expect(first).not.toBe(second);
      expect(first).not.toBe(legacy);
      if (process.platform !== "win32") {
        expect(statSync(first).mode & 0o777).toBe(0o700);
        expect(statSync(second).mode & 0o777).toBe(0o700);
      }
      expect(readFileSync(sentinel, "utf8")).toBe("unrelated data");
      rmSync(first, { recursive: true, force: true });
      expect(statSync(second).isDirectory()).toBe(true);
      expect(readFileSync(sentinel, "utf8")).toBe("unrelated data");
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
