import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Browser, LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { expect, it, vi } from "vitest";
import { processIsAlive } from "../utils/processTree.js";
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
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  } finally {
    child.kill("SIGKILL");
  }
});

it("a forced close also ends what the browser started, as Windows ends no child with its parent", async () => {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const kid = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore", detached: true });
       console.log(kid.pid); setTimeout(() => {}, 60000);`,
    ],
    { stdio: "pipe" },
  );
  const [line] = (await once(child.stdout!, "data")) as [Buffer];
  const kid = Number(String(line).trim());
  const browser = { process: () => child, close: () => once(child, "exit") } as unknown as Browser;
  const puppeteer = {
    launch: async (_options: LaunchOptions) => browser,
  } as unknown as PuppeteerNode;
  try {
    const launched = await launchManagedBrowser(puppeteer, { headless: true }, { diagnose: false });
    await launched.close();
    await vi.waitFor(() => expect(processIsAlive(kid)).toBe(false), { timeout: 2_000 });
  } finally {
    child.kill("SIGKILL");
    if (processIsAlive(kid)) process.kill(kid, "SIGKILL");
  }
});
