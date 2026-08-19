import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import {
  generatePressureBytes,
  generateToneWav,
  preparePlanParityFixture,
} from "./plan-parity-fixture.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("plan parity generated fixtures", () => {
  it("generates a valid deterministic mono PCM WAV", () => {
    const config = { durationSeconds: 0.25, frequencyHz: 440, sampleRate: 48_000 };
    const first = generateToneWav(config);
    const second = generateToneWav(config);
    expect(first.equals(second)).toBe(true);
    expect(first.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(first.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(first.readUInt32LE(24)).toBe(48_000);
    expect(first.readUInt32LE(40)).toBe(24_000);
    expect(first.length).toBe(24_044);
  });

  it("generates deterministic size-pressure bytes that vary with the seed", () => {
    const first = generatePressureBytes(65_536, 123);
    const again = generatePressureBytes(65_536, 123);
    const other = generatePressureBytes(65_536, 124);
    expect(first.equals(again)).toBe(true);
    expect(first.equals(other)).toBe(false);
    expect(new Set(first).size).toBeGreaterThan(240);
  });

  it("materializes the checked-in visual/audio fixture", () => {
    const target = mkdtempSync(join(tmpdir(), "hf-plan-parity-fixture-"));
    cleanup.push(target);
    preparePlanParityFixture(
      join(import.meta.dir, "..", "fixtures", "plan-parity-visual-audio"),
      target,
    );
    const tone = readFileSync(join(target, "assets", "tone.wav"));
    expect(tone.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(readFileSync(join(target, "index.html"), "utf-8")).toContain("assets/tone.wav");
  });

  it("materializes a small compression-resistant pressure payload", () => {
    const target = mkdtempSync(join(tmpdir(), "hf-plan-parity-pressure-"));
    cleanup.push(target);
    preparePlanParityFixture(
      join(import.meta.dir, "..", "fixtures", "plan-parity-size-pressure"),
      target,
    );
    const pressurePath = join(target, "unused-pressure.bin");
    expect(statSync(pressurePath).size).toBe(65_536);
    expect(createHash("sha256").update(readFileSync(pressurePath)).digest("hex")).toBe(
      "0e5f00e17597a73cf7a273d772456db0544959ed19a437954fd800a78447f468",
    );
  });
});
