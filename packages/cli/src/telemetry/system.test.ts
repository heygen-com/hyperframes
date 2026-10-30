import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getSystemMeta execution context", () => {
  it("retains a harness marker after the child agent is recognized", async () => {
    const savedEnv = { ...process.env };
    try {
      process.env["CLAUDECODE"] = "1";
      process.env["HARBOR_AGENT"] = "private-harness-value";
      const { getSystemMeta } = await import("./system.js");
      const meta = getSystemMeta();
      expect(meta.agent_runtime).toBe("claude_code");
      expect(meta.execution_harness_hint).toBe("harbor");
      expect(meta.agent_env_hints).toBeNull();
      expect(JSON.stringify(meta)).not.toContain("private-harness-value");
    } finally {
      process.env = savedEnv;
    }
  });
});

describe("getSystemMeta client", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the launching app's tag from HYPERFRAMES_CLIENT", async () => {
    vi.stubEnv("HYPERFRAMES_CLIENT", "example-app/1.2.3/stable");
    const { getSystemMeta } = await import("./system.js");
    expect(getSystemMeta().client).toBe("example-app/1.2.3/stable");
  });

  it("is null when the CLI runs from a shell", async () => {
    vi.stubEnv("HYPERFRAMES_CLIENT", "");
    const { getSystemMeta } = await import("./system.js");
    expect(getSystemMeta().client).toBeNull();
  });

  it.each([
    "example-app/1.2.3 build 7",
    "example-app/1.2.3\nstable",
    `example-app/${"9".repeat(80)}`,
  ])("drops a tag that is not a short slash-separated slug: %j", async (tag) => {
    vi.stubEnv("HYPERFRAMES_CLIENT", tag);
    const { getSystemMeta } = await import("./system.js");
    expect(getSystemMeta().client).toBeNull();
  });
});

describe("power state (laptop fleet segmentation)", () => {
  it("parsePmsetPowerSource reads battery vs AC", async () => {
    const { parsePmsetPowerSource } = await import("./system.js");
    expect(parsePmsetPowerSource("Now drawing from 'Battery Power'\n -InternalBattery-0")).toBe(
      true,
    );
    expect(parsePmsetPowerSource("Now drawing from 'AC Power'\n -InternalBattery-0")).toBe(false);
    expect(parsePmsetPowerSource("garbage output")).toBe(null);
  });

  it("getPowerState samples pmset on darwin", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "darwin",
    }));
    vi.doMock("node:child_process", async () => ({
      ...(await vi.importActual<typeof import("node:child_process")>("node:child_process")),
      execSync: (cmd: string) =>
        cmd === "pmset -g batt"
          ? "Now drawing from 'Battery Power'\n"
          : "SleepDisabled 0\n lowpowermode         1\n",
    }));
    const { getPowerState } = await import("./system.js");
    expect(getPowerState()).toEqual({ on_battery: true, low_power_mode: true });
  });

  it("getPowerState returns nulls off-darwin (no guessing)", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "linux",
    }));
    const { getPowerState } = await import("./system.js");
    expect(getPowerState()).toEqual({ on_battery: null, low_power_mode: null });
  });

  it("getPowerState survives pmset failure with nulls", async () => {
    vi.doMock("node:os", async () => ({
      ...(await vi.importActual<typeof import("node:os")>("node:os")),
      platform: () => "darwin",
    }));
    vi.doMock("node:child_process", async () => ({
      ...(await vi.importActual<typeof import("node:child_process")>("node:child_process")),
      execSync: () => {
        throw new Error("pmset: command failed");
      },
    }));
    const { getPowerState } = await import("./system.js");
    expect(getPowerState()).toEqual({ on_battery: null, low_power_mode: null });
  });
});
