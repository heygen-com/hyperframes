import { beforeEach, describe, expect, it, vi } from "vitest";

const spinners: Array<{ running: boolean }> = [];
const logError = vi.fn();
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  log: { error: (...args: unknown[]) => logError(...args) },
  spinner: () => {
    const state = { running: false };
    spinners.push(state);
    return {
      start: () => (state.running = true),
      message: vi.fn(),
      stop: () => (state.running = false),
    };
  },
}));

const ensureBrowser = vi.fn();
vi.mock("../browser/manager.js", () => ({
  ensureBrowser: (...args: unknown[]) => ensureBrowser(...args),
  findBrowser: vi.fn(),
  clearBrowser: vi.fn(),
  managedChromeVersion: () => "152.0.7977.30",
  CACHE_DIR: "/cache",
  isLinuxArm: () => false,
}));
vi.mock("../telemetry/events.js", () => ({ trackBrowserInstall: vi.fn() }));

const { default: browserCommand } = await import("./browser.js");

function runEnsure(force: boolean) {
  return browserCommand.run!({
    args: { _: [], subcommand: "ensure", force },
    rawArgs: [],
    cmd: browserCommand,
  });
}

// A spinner left running keeps Node's event loop alive, so the CLI never exits.
describe("browser ensure", () => {
  beforeEach(() => {
    spinners.length = 0;
    logError.mockReset();
    ensureBrowser.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it.each([false, true])(
    "stops its spinner and fails when ensure throws (force=%s)",
    async (force) => {
      ensureBrowser.mockRejectedValue(
        new Error("chrome-headless-shell is missing after unzipping"),
      );

      await expect(runEnsure(force)).rejects.toThrow("Command failed");

      expect(logError).toHaveBeenCalledWith("chrome-headless-shell is missing after unzipping");
      expect(spinners.length).toBeGreaterThan(0);
      expect(spinners.filter((s) => s.running)).toEqual([]);
    },
  );

  it.each([false, true])("leaves no spinner running after success (force=%s)", async (force) => {
    ensureBrowser.mockResolvedValue({ executablePath: "/chrome", source: "download" });

    await runEnsure(force);

    expect(spinners.length).toBeGreaterThan(0);
    expect(spinners.filter((s) => s.running)).toEqual([]);
  });
});
