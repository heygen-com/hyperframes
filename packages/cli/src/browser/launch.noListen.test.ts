import { EventEmitter } from "node:events";
import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => ({ options: [] as LaunchOptions[] }));

vi.mock("./gpuPolicy.js", async (actual) => ({
  ...(await actual<typeof import("./gpuPolicy.js")>()),
  resolveCaptureBrowserGpuMode: async (
    _mode: string,
    _path: string | undefined,
    hooks: { launch: (puppeteer: PuppeteerNode, options: LaunchOptions) => Promise<unknown> },
  ) => {
    const puppeteer = {
      launch: async (options: LaunchOptions) => {
        probe.options.push(options);
        return { process: () => new EventEmitter() };
      },
    } as unknown as PuppeteerNode;
    await hooks.launch(puppeteer, { headless: true, args: ["--headless"] });
    return "software";
  },
}));

import { resolveManagedGpuMode } from "./launch.js";

describe("the GPU probe where nothing may listen", () => {
  it("talks to its Chrome over a pipe in one process, and keeps the usual launch otherwise", async () => {
    await resolveManagedGpuMode("auto", "/chrome", { noListen: true });
    await resolveManagedGpuMode("auto", "/chrome");
    expect(probe.options[0]).toMatchObject({
      pipe: true,
      args: ["--headless", "--single-process", "--disable-gpu-compositing"],
    });
    expect(probe.options[1]!.pipe).toBe(true);
    expect(probe.options[1]!.args).toEqual(["--headless"]);
  });
});

describe("the GPU probe inside an agent's macOS seatbelt", () => {
  const platform = process.platform;
  afterEach(() => {
    vi.unstubAllEnvs();
    Object.defineProperty(process, "platform", { value: platform });
  });

  it("answers software without starting a Chrome the seatbelt would crash", async () => {
    vi.stubEnv("CODEX_SANDBOX", "seatbelt");
    Object.defineProperty(process, "platform", { value: "darwin" });
    probe.options.length = 0;
    await expect(resolveManagedGpuMode("auto", "/chrome")).resolves.toBe("software");
    expect(probe.options).toEqual([]);
  });
});
