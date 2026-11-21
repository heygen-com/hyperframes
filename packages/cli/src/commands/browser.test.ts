import { beforeEach, describe, expect, it, vi } from "vitest";

const spinners: Array<{ running: boolean }> = [];
const logError = vi.fn();
// A person at a terminal: the prompts and spinners these tests drive are refused otherwise.
vi.mock("../utils/attendedTerminal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/attendedTerminal.js")>()),
  isUnattended: () => false,
}));
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
const findBrowser = vi.fn();
let linuxArm = false;
vi.mock("../browser/manager.js", () => ({
  ensureBrowser: (...args: unknown[]) => ensureBrowser(...args),
  findBrowser: (...args: unknown[]) => findBrowser(...args),
  clearBrowser: vi.fn(),
  managedChromeVersion: () => "152.0.7977.30",
  CACHE_DIR: "/cache",
  isLinuxArm: () => linuxArm,
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
    findBrowser.mockReset();
    linuxArm = false;
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

  it("stops its spinner and fails when the Linux ARM64 lookup throws", async () => {
    linuxArm = true;
    findBrowser.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(runEnsure(false)).rejects.toThrow("Command failed");

    expect(logError).toHaveBeenCalledWith("EACCES: permission denied");
    expect(spinners.filter((s) => s.running)).toEqual([]);
  });
});

describe("browser output for people", () => {
  const ODD = "\u001b[2J\u0007";
  const SHOWN = "\\x1b[2J\\x07";

  beforeEach(() => {
    spinners.length = 0;
    logError.mockReset();
    ensureBrowser.mockReset();
    findBrowser.mockReset();
    linuxArm = false;
  });

  // fails without the fix: the failure's own text is printed as it arrived.
  it("shows control characters in an ensure failure as text", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    ensureBrowser.mockRejectedValue(new Error(`no browser at /opt/ch${ODD}rome`));
    await expect(runEnsure(false)).rejects.toThrow("Command failed");
    expect(logError).toHaveBeenCalledWith(`no browser at /opt/ch${SHOWN}rome`);
  });

  // fails without the fix: the browser's path is printed as it is on disk.
  it("shows control characters in the found browser's path as text", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    ensureBrowser.mockResolvedValue({ executablePath: `/opt/ch${ODD}rome`, source: "system" });
    await runEnsure(false);
    const printed = log.mock.calls.flat().join("\n");
    expect(printed).toContain(`/opt/ch${SHOWN}rome`);
    expect(printed).not.toContain(ODD);
  });

  // fails without the fix: the subcommand is printed as it was typed.
  it("shows control characters in an unknown subcommand as text", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      browserCommand.run!({
        args: { _: [], subcommand: `en${ODD}sure`, force: false },
        rawArgs: [],
        cmd: browserCommand,
      }),
    ).rejects.toThrow();
    const printed = error.mock.calls.flat().join("\n");
    expect(printed).toContain(`en${SHOWN}sure`);
    expect(printed).not.toContain(ODD);
  });
});
