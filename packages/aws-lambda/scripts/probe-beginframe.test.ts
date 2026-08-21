import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  _awaitBeforeDeadlineForTests,
  _closeBrowserForProbeTests,
  parseProbeArgs,
} from "./probe-beginframe.js";

describe("parseProbeArgs", () => {
  it("defaults to the @sparticuz/chromium source", () => {
    expect(parseProbeArgs([])).toEqual({});
  });

  it("accepts a standalone executable path", () => {
    expect(parseProbeArgs(["--executable-path", "/opt/chrome/chrome-headless-shell"])).toEqual({
      executablePath: "/opt/chrome/chrome-headless-shell",
    });
  });

  it("accepts the equals form and resolves relative paths", () => {
    expect(parseProbeArgs(["--executable-path=./chrome"])).toEqual({
      executablePath: resolve("./chrome"),
    });
  });

  it("loads exact production launch arguments from JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-probe-args-"));
    const argsPath = join(dir, "args.json");
    writeFileSync(argsPath, JSON.stringify(["--enable-begin-frame-control", "--no-sandbox"]));
    try {
      expect(parseProbeArgs(["--launch-args-json", argsPath])).toEqual({
        launchArgs: ["--enable-begin-frame-control", "--no-sandbox"],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing values and unknown arguments", () => {
    expect(() => parseProbeArgs(["--executable-path"])).toThrow(
      "--executable-path requires a path",
    );
    expect(() => parseProbeArgs(["--source", "chrome"])).toThrow("Unknown argument: --source");
    expect(() => parseProbeArgs(["--launch-args-json"])).toThrow(
      "--launch-args-json requires a path",
    );
  });

  it("bounds a CDP operation that never resolves", async () => {
    const never = new Promise<never>(() => {});
    await expect(
      _awaitBeforeDeadlineForTests(never, Date.now() + 25, "screenshot beginFrame"),
    ).rejects.toThrow("timeout during screenshot beginFrame");
  });

  it("force-kills and disconnects when graceful cleanup never resolves", async () => {
    let killedWith: NodeJS.Signals | number | undefined;
    let disconnected = false;
    await _closeBrowserForProbeTests(
      {
        close: () => new Promise<never>(() => {}),
        process: () => ({
          kill: (signal) => {
            killedWith = signal;
            return true;
          },
        }),
        disconnect: async () => {
          disconnected = true;
        },
      },
      25,
    );

    expect(killedWith).toBe("SIGKILL");
    expect(disconnected).toBe(true);
  });
});
