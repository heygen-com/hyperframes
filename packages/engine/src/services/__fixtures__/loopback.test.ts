import { describe, expect, it, vi } from "vitest";
import type { Browser } from "puppeteer-core";
import { closeTestChrome } from "./loopback.js";

const fakeBrowser = (close: () => Promise<void>) => {
  const kill = vi.fn();
  const disconnect = vi.fn(async () => undefined);
  const browser = { close, disconnect, process: () => ({ kill }) } as unknown as Browser;
  return { browser, kill, disconnect };
};

describe("closeTestChrome", () => {
  it("kills a Chrome whose close never finishes", async () => {
    const { browser, kill, disconnect } = fakeBrowser(() => new Promise(() => undefined));
    await closeTestChrome(browser, 0);
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("leaves a Chrome that closed alone", async () => {
    const { browser, kill } = fakeBrowser(async () => undefined);
    await closeTestChrome(browser, 60_000);
    expect(kill).not.toHaveBeenCalled();
  });
});
