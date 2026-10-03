// fallow-ignore-file code-duplication
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFfmpegBinary } from "./ffmpegBinaries.js";

/** Same probe the ffmpeg-dependent suites use: ask the binary, don't assume it. */
const HAS_FFMPEG = spawnSync(getFfmpegBinary(), ["-version"], { encoding: "utf-8" }).status === 0;

interface ExecFileCall {
  file: string;
  args: readonly string[];
}

/**
 * Node's built-in `child_process.execFile` carries a `util.promisify.custom`
 * implementation that resolves to `{stdout, stderr}`. A plain-callback mock
 * without that Symbol would be promisified as a single-result function — the
 * exact hazard psnr.ts documents. Stamp the custom impl on the mock so
 * promisify keeps the `{stdout, stderr}` shape.
 */
function createExecFileSpy(handler: (args: readonly string[]) => void): {
  execFile: (
    file: string,
    args: readonly string[],
    options: unknown,
    callback: (err: Error | null, stdout?: string, stderr?: string) => void,
  ) => void;
  calls: ExecFileCall[];
} {
  const calls: ExecFileCall[] = [];

  async function run(
    file: string,
    args: readonly string[],
  ): Promise<{ stdout: string; stderr: string }> {
    calls.push({ file, args });
    handler(args);
    return { stdout: "", stderr: "" };
  }

  const execFile = ((
    file: string,
    args: readonly string[],
    _options: unknown,
    callback: (err: Error | null, stdout?: string, stderr?: string) => void,
  ) => {
    run(file, args).then(
      ({ stdout, stderr }) => process.nextTick(() => callback(null, stdout, stderr)),
      (err: Error) => process.nextTick(() => callback(err)),
    );
  }) as ((
    file: string,
    args: readonly string[],
    options: unknown,
    callback: (err: Error | null, stdout?: string, stderr?: string) => void,
  ) => void) & { [key: symbol]: unknown };
  (execFile as { [k: symbol]: unknown })[promisify.custom] = (
    file: string,
    args: readonly string[],
  ) => run(file, args);

  return { execFile, calls };
}

const envBackup: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in envBackup)) envBackup[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("node:child_process");
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete envBackup[key];
  }
});

describe("resolveDeVerifyMinDb", () => {
  it("defaults to 32 when unset and honors an in-range override", async () => {
    const { resolveDeVerifyMinDb } = await import("./psnr.js");
    setEnv("HF_DE_VERIFY_MIN_DB", undefined);
    expect(resolveDeVerifyMinDb()).toBe(32);
    setEnv("HF_DE_VERIFY_MIN_DB", "45");
    expect(resolveDeVerifyMinDb()).toBe(45);
  });

  it("falls back to 32 for out-of-range or malformed values", async () => {
    const { resolveDeVerifyMinDb } = await import("./psnr.js");
    for (const bad of ["5", "61", "banana", ""]) {
      setEnv("HF_DE_VERIFY_MIN_DB", bad);
      expect(resolveDeVerifyMinDb()).toBe(32);
    }
  });
});

describe("resolveDeVerifyMaxShift", () => {
  it("defaults to 3 when unset and honors an in-range override", async () => {
    const { resolveDeVerifyMaxShift } = await import("./psnr.js");
    setEnv("HF_DE_VERIFY_MAX_SHIFT", undefined);
    expect(resolveDeVerifyMaxShift()).toBe(3);
    setEnv("HF_DE_VERIFY_MAX_SHIFT", "8");
    expect(resolveDeVerifyMaxShift()).toBe(8);
  });

  it("falls back to 3 for out-of-range or malformed values", async () => {
    const { resolveDeVerifyMaxShift } = await import("./psnr.js");
    for (const bad of ["0", "65", "banana", ""]) {
      setEnv("HF_DE_VERIFY_MAX_SHIFT", bad);
      expect(resolveDeVerifyMaxShift()).toBe(3);
    }
  });
});

describe("regionShift", () => {
  it("returns the max |cell-128| of the downscaled signed-diff frame", async () => {
    // The mock writes the canned rawvideo cell payload to the output path
    // (last argv), so the real readFile + scan path runs end to end.
    const cells = Buffer.from([128, 128, 128, 137, 128, 128, 90, 128, 128]);
    const { execFile, calls } = createExecFileSpy((args) => {
      const outPath = args[args.length - 1];
      if (typeof outPath !== "string") throw new Error("no outpath in argv");
      writeFileSync(outPath, cells);
    });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { regionShift } = await import("./psnr.js");
    await expect(regionShift(Buffer.from("a"), Buffer.from("b"))).resolves.toBe(38);
    const argv = (calls[0]?.args ?? []).join(" ");
    expect(argv).toContain("grainextract");
    expect(argv).toContain("flags=area");
    expect(argv).toContain("rawvideo");
  });

  it("throws on empty rawvideo output", async () => {
    const { execFile } = createExecFileSpy((args) => {
      const outPath = args[args.length - 1];
      if (typeof outPath !== "string") throw new Error("no outpath in argv");
      writeFileSync(outPath, Buffer.alloc(0));
    });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { regionShift } = await import("./psnr.js");
    await expect(regionShift(Buffer.from("a"), Buffer.from("b"))).rejects.toThrow(/empty rawvideo/);
  });
});

describe.skipIf(!HAS_FFMPEG)("regionShift + psnrDb against real ffmpeg (issue #3345 repro)", () => {
  let dir: string;
  let truth: Buffer;
  let lowContrastMissing: Buffer;
  let highContrastMissing: Buffer;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hf-psnr-test-"));
    const ff = getFfmpegBinary();
    const mk = (out: string, drawbox?: string) => {
      const src = "color=c=0x12122E:s=1920x1080:d=1";
      const args = drawbox
        ? ["-v", "error", "-y", "-f", "lavfi", "-i", src, "-vf", drawbox, "-frames:v", "1", out]
        : ["-v", "error", "-y", "-f", "lavfi", "-i", src, "-frames:v", "1", out];
      execFileSync(ff, args);
    };
    // The reporter's synthetic pair, at 1080p: a ~4/255-luma band over ~15%
    // of the frame — invisible to a whole-frame magnitude average.
    const truthPath = join(dir, "truth.jpg");
    const lowPath = join(dir, "low.jpg");
    const highPath = join(dir, "high.jpg");
    mk(truthPath);
    mk(lowPath, "drawbox=x=0:y=450:w=1920:h=160:color=0x161632:t=fill");
    mk(highPath, "drawbox=x=0:y=450:w=1920:h=160:color=0xFFFFFF:t=fill");
    truth = readFileSync(truthPath);
    lowContrastMissing = readFileSync(lowPath);
    highContrastMissing = readFileSync(highPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("catches the missing low-contrast element that the 32dB PSNR gate passes", async () => {
    const { psnrDb, regionShift } = await import("./psnr.js");
    // Sabotage assertion: the pre-fix gate genuinely passes this damage.
    const db = await psnrDb(lowContrastMissing, truth);
    expect(db).toBeGreaterThan(32);
    // The new presence check reads the region's full ~4/255 delta.
    const shift = await regionShift(lowContrastMissing, truth);
    expect(shift).toBeGreaterThanOrEqual(3);
  });

  it("still reads saturated damage far above the ceiling", async () => {
    const { regionShift } = await import("./psnr.js");
    expect(await regionShift(highContrastMissing, truth)).toBeGreaterThan(64);
  });

  it("reports ~0 on an identical pair and stays under the ceiling on pure encoder noise", async () => {
    const { regionShift } = await import("./psnr.js");
    expect(await regionShift(truth, truth)).toBe(0);
    // Re-encode the truth at a different jpeg quality: the difference is pure
    // encoder noise with no missing content — must not trip the gate.
    const noisyPath = join(dir, "noisy.jpg");
    execFileSync(getFfmpegBinary(), [
      "-v",
      "error",
      "-y",
      "-i",
      join(dir, "truth.jpg"),
      "-q:v",
      "12",
      noisyPath,
    ]);
    expect(await regionShift(readFileSync(noisyPath), truth)).toBeLessThanOrEqual(2);
  });
});
