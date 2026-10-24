import { EventEmitter } from "node:events";
import {
  ProtocolError,
  type Browser,
  type LaunchOptions,
  type PuppeteerNode,
} from "puppeteer-core";
import { TargetCloseError } from "puppeteer-core/internal/common/Errors.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchManagedBrowser } from "./launch.js";

const SEATBELT_LAUNCH_FAILURE = [
  "Failed to launch the browser process:  Code: null",
  "",
  "stderr:",
  "[1016/170315.389548:FATAL:base/apple/mach_port_rendezvous_mac.cc:159] Check failed: kr == KERN_SUCCESS. bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer.26166: Permission denied (1100)",
].join("\n");

const failingPuppeteer = (message: string) =>
  ({ launch: async (_: LaunchOptions) => Promise.reject(new Error(message)) }) as PuppeteerNode;

describe("a browser launch a sandbox refuses", () => {
  it("tells the caller to rerun with escalation instead of showing Chrome's crash", async () => {
    await expect(
      launchManagedBrowser(failingPuppeteer(SEATBELT_LAUNCH_FAILURE), {}),
    ).rejects.toMatchObject({
      message:
        "The browser can't start inside this sandbox: macOS refused Chrome's mach service (bootstrap_check_in: Permission denied).\nRerun this command with escalation, outside the sandbox.",
      cause: { message: SEATBELT_LAUNCH_FAILURE },
    });
  });

  it("leaves any other launch failure as it was", async () => {
    const other = "Failed to launch the browser process:  Code: 1";
    await expect(launchManagedBrowser(failingPuppeteer(other), {})).rejects.toThrow(other);
  });
});

const fakeBrowser = () => ({ process: () => new EventEmitter() }) as unknown as Browser;

function recordingPuppeteer(failures: (string | Error)[]) {
  const launches: LaunchOptions[] = [];
  const puppeteer = {
    launch: async (options: LaunchOptions) => {
      launches.push(options);
      const failure = failures.shift();
      if (failure) throw typeof failure === "string" ? new Error(failure) : failure;
      return fakeBrowser();
    },
  } as unknown as PuppeteerNode;
  return { puppeteer, launches };
}

describe("a browser inside an agent's macOS seatbelt", () => {
  const platform = process.platform;
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process, "platform", { value: platform });
  });

  it("starts as one process over a pipe when Codex names its seatbelt", async () => {
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");
    Object.defineProperty(process, "platform", { value: "darwin" });
    const { puppeteer, launches } = recordingPuppeteer([]);
    await launchManagedBrowser(puppeteer, { args: ["--headless"] });
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({
      pipe: true,
      args: ["--headless", "--single-process", "--disable-gpu-compositing"],
    });
  });

  it("relaunches as one process over a pipe when an unnamed sandbox refuses the mach service", async () => {
    vi.stubEnv("CODEX_SANDBOX", "");
    const { puppeteer, launches } = recordingPuppeteer([SEATBELT_LAUNCH_FAILURE]);
    await expect(launchManagedBrowser(puppeteer, { args: ["--headless"] })).resolves.toBeDefined();
    expect(launches.map((options) => options.pipe ?? false)).toEqual([true, true]);
    expect(launches[0]!.args).toEqual(["--headless"]);
    expect(launches[1]!.args).toEqual([
      "--headless",
      "--single-process",
      "--disable-gpu-compositing",
    ]);
  });
  it("relaunches as one process when an unnamed sandbox closes a pipe launch before its first targets", async () => {
    vi.stubEnv("CODEX_SANDBOX", "");
    Object.defineProperty(process, "platform", { value: "darwin" });
    const { puppeteer, launches } = recordingPuppeteer([
      new TargetCloseError("Protocol error (Target.setDiscoverTargets): Target closed"),
    ]);
    await expect(launchManagedBrowser(puppeteer, { args: ["--headless"] })).resolves.toBeDefined();
    expect(launches.map((options) => options.args)).toEqual([
      ["--headless"],
      ["--headless", "--single-process", "--disable-gpu-compositing"],
    ]);
  });

  it("leaves any other protocol error failed on macOS", async () => {
    vi.stubEnv("CODEX_SANDBOX", "");
    Object.defineProperty(process, "platform", { value: "darwin" });
    const other = new ProtocolError("Protocol error (Target.setDiscoverTargets): Not allowed");
    const { puppeteer, launches } = recordingPuppeteer([other]);
    await expect(launchManagedBrowser(puppeteer, { args: ["--headless"] })).rejects.toBe(other);
    expect(launches).toHaveLength(1);
  });

  it("leaves a closed pipe launch failed off macOS, where no seatbelt exists", async () => {
    vi.stubEnv("CODEX_SANDBOX", "");
    Object.defineProperty(process, "platform", { value: "linux" });
    const closed = new TargetCloseError(
      "Protocol error (Target.setDiscoverTargets): Target closed",
    );
    const { puppeteer, launches } = recordingPuppeteer([closed]);
    await expect(launchManagedBrowser(puppeteer, { args: ["--headless"] })).rejects.toBe(closed);
    expect(launches).toHaveLength(1);
  });
});

describe("a browser launch that never settles", () => {
  it("gives up at its timeout, as when Chrome dies while puppeteer waits for its first targets", async () => {
    const stuck = { launch: () => new Promise<Browser>(() => {}) } as unknown as PuppeteerNode;
    await expect(launchManagedBrowser(stuck, { timeout: 50 })).rejects.toThrow(
      "The browser did not finish starting within 50 ms.",
    );
  });
});
