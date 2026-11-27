import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { expect, it } from "vitest";
import { launchManagedBrowser } from "./launch.js";

// A helper that outlives the browser inherits its pipes, as Chrome's crashpad handler does.
const SPAWN_ORPHAN = `
  require("node:child_process")
    .spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], { detached: true, stdio: ["ignore", "inherit", "inherit", 3, 4] })
    .unref();
`;

it("closes the browser's pipes when it exits, so an orphaned helper cannot hold the CLI open", async () => {
  const child = spawn(process.execPath, ["-e", SPAWN_ORPHAN], {
    stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  const puppeteer = {
    launch: async (_options: LaunchOptions) => ({ process: () => child, close: async () => {} }),
  } as unknown as PuppeteerNode;
  await launchManagedBrowser(puppeteer, { headless: true }, { diagnose: false });
  await expect
    .poll(() => child.stdio.every((pipe) => pipe?.destroyed), { timeout: 3000 })
    .toBe(true);
});

// fails without the fix: launchOwnedBrowser left child.stdio unguarded after PipeTransport.close.
it("absorbs late EPIPE on the browser's CDP pipe after Puppeteer drops its listener", async () => {
  const pipe = new EventEmitter();
  const puppeteerListener = () => {};
  pipe.on("error", puppeteerListener);
  const child = Object.assign(new EventEmitter(), {
    stdio: [null, null, null, pipe],
    exitCode: null,
    signalCode: null,
  });
  const puppeteer = {
    launch: async (_options: LaunchOptions) => ({
      process: () => child,
      close: async () => {
        pipe.off("error", puppeteerListener);
      },
      newPage: async () => ({}),
    }),
  } as unknown as PuppeteerNode;
  await launchManagedBrowser(puppeteer, { headless: true }, { diagnose: false });
  // Simulate PipeTransport.close() disposing its listener when Chrome's read pipe closes.
  pipe.off("error", puppeteerListener);
  expect(() =>
    pipe.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })),
  ).not.toThrow();
});
