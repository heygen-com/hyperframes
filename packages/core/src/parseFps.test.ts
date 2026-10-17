import { describe, expect, it } from "vitest";
import { fpsToFfmpegArg, fpsToNumber, parseFps } from "./core.types";
import { DISTRIBUTED_FPS, isDistributedFps } from "./distributedFps";

describe("parseFps — integer forms", () => {
  it("parses integer string '30' as { num: 30, den: 1 }", () => {
    const result = parseFps("30");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ num: 30, den: 1 });
  });

  it("parses integer number 30 as { num: 30, den: 1 }", () => {
    const result = parseFps(30);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ num: 30, den: 1 });
  });

  it("parses '24' / '60' / '120' / '240' as integer fps with den=1", () => {
    for (const n of [24, 60, 120, 240]) {
      const result = parseFps(String(n));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ num: n, den: 1 });
    }
  });

  it("trims surrounding whitespace on integer strings", () => {
    const result = parseFps("  30  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ num: 30, den: 1 });
  });
});

describe("parseFps — rational forms", () => {
  it("parses '30000/1001' as exact NTSC", () => {
    const result = parseFps("30000/1001");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ num: 30000, den: 1001 });
  });

  it("parses '24000/1001' as 23.976", () => {
    const result = parseFps("24000/1001");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ num: 24000, den: 1001 });
  });

  it("parses '60000/1001' as 59.94", () => {
    const result = parseFps("60000/1001");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ num: 60000, den: 1001 });
  });

  it("parses '60/2' as { num: 60, den: 2 } (no auto-simplification)", () => {
    // Preserving the literal numerator/denominator keeps `fpsToFfmpegArg`
    // round-trippable — if the user typed the rational form, we forward it
    // verbatim to ffmpeg.
    const result = parseFps("60/2");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ num: 60, den: 2 });
  });
});

describe("parseFps — rejected inputs", () => {
  it("rejects 'abc'", () => {
    const result = parseFps("abc");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-a-number");
  });

  it("rejects '30/0' (zero denominator)", () => {
    const result = parseFps("30/0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-fraction");
  });

  it("rejects '30/-1' (negative denominator)", () => {
    const result = parseFps("30/-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-fraction");
  });

  it("rejects '0' (non-positive)", () => {
    const result = parseFps("0");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("non-positive");
  });

  it("rejects '241' (out of range)", () => {
    const result = parseFps("241");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("out-of-range");
  });

  it("rejects '29.97' (ambiguous decimal — must spell rational)", () => {
    // The whole point of taking rationals is precision; accepting the
    // decimal form silently would invert that guarantee.
    const result = parseFps("29.97");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ambiguous-decimal");
  });

  it("rejects empty string", () => {
    const result = parseFps("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("rejects '30000/1001/extra' (too many slashes)", () => {
    const result = parseFps("30000/1001/extra");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-fraction");
  });

  it("rejects rational with decimal numerator '30.5/1'", () => {
    const result = parseFps("30.5/1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-fraction");
  });

  it("rejects rational > 240 by decimal value", () => {
    // 1000/3 ≈ 333.33 — even though numerator and denominator are integers,
    // the decimal value is out of the supported range.
    const result = parseFps("1000/3");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("out-of-range");
  });
});

describe("fpsToNumber + fpsToFfmpegArg + frame interval math", () => {
  it("integer fps 30/1 → 33.333…ms frame interval", () => {
    const fps = { num: 30, den: 1 };
    const intervalMs = (1000 * fps.den) / fps.num;
    expect(intervalMs).toBeCloseTo(33.333, 3);
  });

  it("NTSC 30000/1001 → 33.366…ms frame interval", () => {
    const fps = { num: 30000, den: 1001 };
    const intervalMs = (1000 * fps.den) / fps.num;
    // 1001/30 = 33.36666…ms — the canonical NTSC interval. Differs from
    // the integer-30 interval by ~0.033 ms (1 ULP at our scales).
    expect(intervalMs).toBeCloseTo(33.36666, 3);
    expect(intervalMs).not.toBeCloseTo(33.333, 3);
  });

  it("fpsToNumber collapses rational to decimal", () => {
    expect(fpsToNumber({ num: 30, den: 1 })).toBe(30);
    expect(fpsToNumber({ num: 30000, den: 1001 })).toBeCloseTo(29.97003, 5);
  });

  it("fpsToFfmpegArg emits bare integer for den=1", () => {
    expect(fpsToFfmpegArg({ num: 30, den: 1 })).toBe("30");
    expect(fpsToFfmpegArg({ num: 60, den: 1 })).toBe("60");
  });

  it("fpsToFfmpegArg emits 'num/den' for rationals", () => {
    expect(fpsToFfmpegArg({ num: 30000, den: 1001 })).toBe("30000/1001");
    expect(fpsToFfmpegArg({ num: 24000, den: 1001 })).toBe("24000/1001");
    expect(fpsToFfmpegArg({ num: 60000, den: 1001 })).toBe("60000/1001");
  });
});

describe("isDistributedFps", () => {
  it("accepts exactly the integer rates the distributed renderer supports", () => {
    expect(DISTRIBUTED_FPS).toEqual([24, 25, 30, 60]);
    for (const n of DISTRIBUTED_FPS) expect(isDistributedFps(n)).toBe(true);
  });

  it("rejects other rates, fractions and non-numbers", () => {
    for (const v of [0, 23.976, 29.97, 48, 50, 120, "30", null, undefined]) {
      expect(isDistributedFps(v)).toBe(false);
    }
  });
});
