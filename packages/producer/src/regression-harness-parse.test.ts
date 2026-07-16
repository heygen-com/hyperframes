// Pure-function tests for `parseArgs()` in the regression harness. Pins the
// `--exclude-tags` comma-parsing contract that the values baked into
// `Dockerfile.test` and `packages/producer/package.json` test scripts depend
// on. When someone changes the parser (e.g. to space-separated or repeated
// flags) these tests + the invocation strings in the Dockerfile / package.json
// must move together.

import { describe, expect, it } from "bun:test";
import { parseArgs } from "./regression-harness.js";

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
