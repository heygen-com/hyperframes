import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Browser, LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { expect, it } from "vitest";
import { launchManagedBrowser } from "./launch.js";

it("kills a browser that acknowledged close but never exits, so every caller's close() returns", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "pipe" });
  const browser = { process: () => child, close: () => once(child, "exit") } as unknown as Browser;
  const puppeteer = {
    launch: async (_options: LaunchOptions) => browser,
  } as unknown as PuppeteerNode;
  try {
    const launched = await launchManagedBrowser(puppeteer, { headless: true }, { diagnose: false });
    await launched.close();
    expect(child.signalCode).toBe("SIGKILL");
  } finally {
    child.kill("SIGKILL");
  }
});
