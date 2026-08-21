import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Pins the security-relevant contract of the `--yes` install path: the detected
 * manager binary is spawned via execFileSync with `shell: false` and the exact
 * argv from installInvocation — no shell, so a version can never be re-parsed
 * as shell syntax. installInvocation's argv correctness is covered separately
 * in installerDetection.test.ts; this locks how it's executed.
 */
describe("runDetectedInstall", () => {
  afterEach(() => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
  });

  it("spawns the manager binary with shell:false and inherited stdio", async () => {
    const execSpy = vi.fn();
    vi.resetModules();
    vi.doMock("node:child_process", () => ({ execFileSync: execSpy }));

    const { runDetectedInstall } = await import("./upgrade.js");
    runDetectedInstall(
      { bin: "bun", args: ["add", "-g", "hyperframes@1.2.3"] },
      "bun add -g hyperframes@1.2.3",
      "1.2.3",
    );

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy).toHaveBeenCalledWith("bun", ["add", "-g", "hyperframes@1.2.3"], {
      stdio: "inherit",
      shell: false,
    });
  });

  it("sets a non-zero exit code when the install fails, without throwing", async () => {
    const execSpy = vi.fn(() => {
      throw new Error("install boom");
    });
    vi.resetModules();
    vi.doMock("node:child_process", () => ({ execFileSync: execSpy }));

    const { runDetectedInstall } = await import("./upgrade.js");
    try {
      expect(() =>
        runDetectedInstall(
          { bin: "npm", args: ["install", "-g", "hyperframes@1.2.3"] },
          "npm install -g hyperframes@1.2.3",
          "1.2.3",
        ),
      ).not.toThrow();
      const { consumeCommandResult } = await import("../utils/commandResult.js");
      expect(consumeCommandResult().exitCode).toBe(1);
    } finally {
      const { consumeCommandResult } = await import("../utils/commandResult.js");
      consumeCommandResult();
    }
  });
});
