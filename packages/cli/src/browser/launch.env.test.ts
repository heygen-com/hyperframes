import { EventEmitter } from "node:events";
import type { Browser, LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchManagedBrowser } from "./launch.js";

function recordingPuppeteer() {
  const launches: LaunchOptions[] = [];
  const puppeteer = {
    launch: async (options: LaunchOptions) => {
      launches.push(options);
      return { process: () => new EventEmitter(), close: async () => {} } as unknown as Browser;
    },
  } as unknown as PuppeteerNode;
  return { puppeteer, launches };
}

describe("the environment a CLI browser starts with", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps what Chrome uses and leaves the rest of the CLI's environment behind", async () => {
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "kept-from-chrome");
    vi.stubEnv("LANG", "en_US.UTF-8");
    const { puppeteer, launches } = recordingPuppeteer();
    await launchManagedBrowser(puppeteer, { args: ["--no-sandbox"] });
    expect(launches[0]?.env).toMatchObject({ PATH: process.env.PATH, LANG: "en_US.UTF-8" });
    expect(launches[0]?.env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
  });

  it("filters a caller's own environment the same way", async () => {
    const { puppeteer, launches } = recordingPuppeteer();
    await launchManagedBrowser(puppeteer, {
      args: ["--no-sandbox"],
      env: { PATH: "/bin", GITHUB_TOKEN: "kept-from-chrome" },
    });
    expect(launches[0]?.env).toEqual({ PATH: "/bin" });
  });
});
