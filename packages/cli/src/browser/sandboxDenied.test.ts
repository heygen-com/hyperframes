import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { describe, expect, it } from "vitest";
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
