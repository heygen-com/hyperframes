import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ launch: vi.fn(), proxyClose: vi.fn(), exit: vi.fn() }));
vi.mock("puppeteer-core", () => ({ default: { launch: mocks.launch } }));
vi.mock("./captureProxy.js", () => ({
  startCaptureProxy: async () => ({ url: "http://127.0.0.1:4567", close: mocks.proxyClose }),
}));
vi.mock("../utils/commandResult.js", () => ({ requestCliExit: mocks.exit }));

const originalSignals = new Map(
  (["SIGINT", "SIGTERM"] as const).map((signal) => [signal, process.listeners(signal)]),
);
let profile: string | undefined;
afterEach(async () => {
  for (const [signal, original] of originalSignals) {
    for (const listener of process.listeners(signal)) {
      if (!original.includes(listener)) process.removeListener(signal, listener);
    }
  }
  if (profile) await rm(profile, { recursive: true, force: true });
  vi.resetModules();
  vi.resetAllMocks();
});

it.each(["SIGINT", "SIGTERM"] as const)(
  "joins capture profile cleanup before root exit on %s without session.close",
  async (signal) => {
    const child = Object.assign(new EventEmitter(), {
      pid: process.pid,
      exitCode: null as number | null,
      signalCode: null,
    });
    const close = vi.fn(async () => {
      child.exitCode = 0;
      child.emit("exit", 0);
      browser.emit("disconnected");
    });
    const browser = Object.assign(new EventEmitter(), {
      process: () => child,
      close,
      newPage: vi.fn(),
    });
    mocks.launch.mockResolvedValue(browser);
    mocks.proxyClose.mockResolvedValue(undefined);
    const { launchCaptureBrowser } = await import("./launchCaptureBrowser.js");
    const session = await launchCaptureBrowser({
      executablePath: "/chrome",
      protocolTimeout: 1000,
      disableWebgl: false,
      width: 800,
      height: 600,
    });
    profile = mocks.launch.mock.calls[0]?.[0].userDataDir;
    expect(existsSync(profile!)).toBe(true);
    const exit = new Promise<{ code: number; profileExists: boolean }>((resolve) => {
      mocks.exit.mockImplementation((code: number) => {
        resolve({ code, profileExists: existsSync(profile!) });
      });
    });
    process.emit(signal);
    expect(await exit).toEqual({ code: signal === "SIGINT" ? 130 : 143, profileExists: false });
    await session.close();
    await session.close();
    expect(close).toHaveBeenCalledOnce();
  },
);
