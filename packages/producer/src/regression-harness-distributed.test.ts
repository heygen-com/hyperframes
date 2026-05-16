// Pure-function tests for the harness mode dispatch logic. End-to-end
// PSNR contract lives in `Dockerfile.test` runs of the regression harness.

import { describe, expect, it } from "bun:test";
import {
  checkDistributedSupport,
  DISTRIBUTED_SIMULATED_MIN_PSNR_DB,
  parseHarnessModeFlag,
  resolveMinPsnrForMode,
} from "./regression-harness-distributed.js";

describe("parseHarnessModeFlag()", () => {
  it("parses --mode=in-process", () => {
    expect(parseHarnessModeFlag("--mode=in-process")).toBe("in-process");
  });

  it("parses --mode=distributed-simulated", () => {
    expect(parseHarnessModeFlag("--mode=distributed-simulated")).toBe("distributed-simulated");
  });

  it("returns null for tokens that aren't --mode", () => {
    expect(parseHarnessModeFlag("--update")).toBeNull();
    expect(parseHarnessModeFlag("font-variant-numeric")).toBeNull();
    expect(parseHarnessModeFlag("--exclude-tags")).toBeNull();
  });

  it("throws on a known prefix with a bad value", () => {
    expect(() => parseHarnessModeFlag("--mode=foo")).toThrow(/--mode must be/);
    expect(() => parseHarnessModeFlag("--mode=")).toThrow(/--mode must be/);
  });
});

describe("checkDistributedSupport()", () => {
  it("accepts mp4 SDR at 24 / 30 / 60 fps", () => {
    for (const fpsNum of [24, 30, 60]) {
      const result = checkDistributedSupport({ fps: { num: fpsNum, den: 1 } });
      expect(result.supported).toBe(true);
    }
  });

  it("accepts explicit format=mp4", () => {
    const result = checkDistributedSupport({ fps: { num: 30, den: 1 }, format: "mp4" });
    expect(result.supported).toBe(true);
  });

  it("rejects fps with non-1 denominator (NTSC)", () => {
    const result = checkDistributedSupport({ fps: { num: 30000, den: 1001 } });
    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.reason).toMatch(/non-integer fps/);
    }
  });

  it("rejects fps outside the {24,30,60} set", () => {
    for (const fpsNum of [12, 25, 48, 50, 120]) {
      const result = checkDistributedSupport({ fps: { num: fpsNum, den: 1 } });
      expect(result.supported).toBe(false);
      if (!result.supported) {
        expect(result.reason).toMatch(/not in \{24, 30, 60\}/);
      }
    }
  });

  it("rejects format=webm", () => {
    const result = checkDistributedSupport({ fps: { num: 30, den: 1 }, format: "webm" });
    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.reason).toMatch(/webm/);
    }
  });

  it("rejects hdr=true", () => {
    const result = checkDistributedSupport({ fps: { num: 30, den: 1 }, hdr: true });
    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.reason).toMatch(/hdr/);
    }
  });

  it("accepts hdr=false (or unset)", () => {
    expect(checkDistributedSupport({ fps: { num: 30, den: 1 }, hdr: false }).supported).toBe(true);
    expect(checkDistributedSupport({ fps: { num: 30, den: 1 } }).supported).toBe(true);
  });
});

describe("resolveMinPsnrForMode()", () => {
  it("in-process mode uses the fixture's own threshold verbatim", () => {
    expect(resolveMinPsnrForMode("in-process", 30)).toBe(30);
    expect(resolveMinPsnrForMode("in-process", 50)).toBe(50);
    expect(resolveMinPsnrForMode("in-process", 60)).toBe(60);
  });

  it("distributed-simulated uses the fixture's own minPsnr when above the absolute floor", () => {
    // Fixtures with minPsnr >= the absolute floor (catastrophic-failure
    // guard) use their authored threshold unchanged. Distributed must pass
    // the same quality bar the in-process renderer passes against the same
    // baseline — no extra tightening, since baseline drift is shared across
    // modes.
    expect(resolveMinPsnrForMode("distributed-simulated", 30)).toBe(30);
    expect(resolveMinPsnrForMode("distributed-simulated", 50)).toBe(50);
    expect(resolveMinPsnrForMode("distributed-simulated", 80)).toBe(80);
  });

  it("distributed-simulated raises pathologically-low thresholds to the absolute floor", () => {
    // A fixture authored with minPsnr=0 (or very low) wouldn't catch a
    // distributed-mode renderer producing fully-black output. The absolute
    // floor exists to catch that pathology.
    expect(resolveMinPsnrForMode("distributed-simulated", 0)).toBe(
      DISTRIBUTED_SIMULATED_MIN_PSNR_DB,
    );
    expect(resolveMinPsnrForMode("distributed-simulated", 5)).toBe(
      DISTRIBUTED_SIMULATED_MIN_PSNR_DB,
    );
  });

  it("every committed fixture authors a minPsnr above the absolute floor", async () => {
    // The pathology floor only fires for a fixture whose authored minPsnr
    // is below it — by design that should be no committed fixture. If
    // someone lands a permissive fixture (minPsnr: 5), distributed mode
    // will silently use 10 dB instead, which is the right behavior but
    // worth flagging so reviewers ask "is this fixture really meant to
    // accept near-black output?". This test prevents accidental misuse
    // by failing loudly when a fixture drops below the floor.
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    const testsDir = pathJoin(import.meta.dir, "..", "tests");
    const offenders: Array<{ fixture: string; minPsnr: number }> = [];
    for (const entry of readdirSync(testsDir)) {
      const metaPath = pathJoin(testsDir, entry, "meta.json");
      let stat;
      try {
        stat = statSync(metaPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { minPsnr?: unknown };
      if (typeof meta.minPsnr === "number" && meta.minPsnr < DISTRIBUTED_SIMULATED_MIN_PSNR_DB) {
        offenders.push({ fixture: entry, minPsnr: meta.minPsnr });
      }
    }
    expect(offenders).toEqual([]);
  });
});
