import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ExecFileCall {
  file: string;
  args: readonly string[];
}

type ExecFileOutcome =
  | { kind: "ok"; stdout: string; stderr?: string }
  | { kind: "exit_nonzero"; code: number; stdout?: string; stderr?: string }
  | { kind: "enoent" };

// Node's built-in `child_process.execFile` carries a `util.promisify.custom`
// implementation that resolves to `{stdout, stderr}`. A plain-callback mock
// without that Symbol would be promisified as a single-result function, so
// `{stdout} = await execFileP(...)` would silently destructure to `undefined`
// — the exact hazard psnr.ts documents. Stamp the custom impl on the mock so
// promisify keeps the `{stdout, stderr}` shape.
function createExecFileSpy(outcome: ExecFileOutcome): {
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
    if (outcome.kind === "enoent") {
      const err = new Error("spawn ffmpeg ENOENT") as NodeJS.ErrnoException;
      err.code = "ENOENT";
      throw err;
    }
    if (outcome.kind === "exit_nonzero") {
      const err = new Error(`Command failed: ffmpeg (exit ${outcome.code})`) as Error & {
        code: number;
        stdout?: string;
        stderr?: string;
      };
      err.code = outcome.code;
      err.stdout = outcome.stdout ?? "";
      err.stderr = outcome.stderr ?? "";
      throw err;
    }
    return { stdout: outcome.stdout, stderr: outcome.stderr ?? "" };
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

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock("node:child_process");
});

describe("isPsnrFilterAvailable", () => {
  it("returns true when `ffmpeg -filters` output lists the psnr filter", async () => {
    const { execFile } = createExecFileSpy({
      kind: "ok",
      stdout: [
        "Filters:",
        "  T.. overlay          VV->V      Overlay a video source on top of the input.",
        "  T.. psnr             VV->V      Calculate the PSNR between two video streams.",
        "  ... yadif            V->V       Deinterlace the input image.",
      ].join("\n"),
    });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { isPsnrFilterAvailable } = await import("./psnrFilterAvailability.js");
    await expect(isPsnrFilterAvailable()).resolves.toBe(true);
  });

  it("returns false when `ffmpeg -filters` output omits the psnr filter", async () => {
    const { execFile } = createExecFileSpy({
      kind: "ok",
      stdout: [
        "Filters:",
        "  T.. overlay          VV->V      Overlay a video source on top of the input.",
        "  ... yadif            V->V       Deinterlace the input image.",
      ].join("\n"),
    });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { isPsnrFilterAvailable } = await import("./psnrFilterAvailability.js");
    await expect(isPsnrFilterAvailable()).resolves.toBe(false);
  });

  it("returns false when the ffmpeg binary is missing (ENOENT from execFile)", async () => {
    const { execFile } = createExecFileSpy({ kind: "enoent" });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { isPsnrFilterAvailable } = await import("./psnrFilterAvailability.js");
    await expect(isPsnrFilterAvailable()).resolves.toBe(false);
  });

  it("returns false on a non-zero exit from `ffmpeg -filters`", async () => {
    const { execFile } = createExecFileSpy({
      kind: "exit_nonzero",
      code: 1,
      stderr: "Unrecognized option '-filters'.",
    });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { isPsnrFilterAvailable } = await import("./psnrFilterAvailability.js");
    await expect(isPsnrFilterAvailable()).resolves.toBe(false);
  });

  it("memoizes the probe across calls and re-probes after resetPsnrFilterAvailabilityCache", async () => {
    const { execFile, calls } = createExecFileSpy({
      kind: "ok",
      stdout: "  T.. psnr             VV->V      Calculate the PSNR",
    });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { isPsnrFilterAvailable, resetPsnrFilterAvailabilityCache } =
      await import("./psnrFilterAvailability.js");

    await isPsnrFilterAvailable();
    await isPsnrFilterAvailable();
    await isPsnrFilterAvailable();
    expect(calls.length).toBe(1);

    resetPsnrFilterAvailabilityCache();
    await isPsnrFilterAvailable();
    expect(calls.length).toBe(2);
  });

  it("does not treat a whole-string 'psnr' inside another word as the filter", async () => {
    const { execFile } = createExecFileSpy({
      kind: "ok",
      stdout: [
        "Filters:",
        "  T.. bpsnrx            V->V       (hypothetical extended filter, not the real psnr)",
      ].join("\n"),
    });
    vi.doMock("node:child_process", () => ({ execFile }));

    const { isPsnrFilterAvailable } = await import("./psnrFilterAvailability.js");
    await expect(isPsnrFilterAvailable()).resolves.toBe(false);
  });
});
