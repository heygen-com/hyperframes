import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import type { Browser } from "puppeteer-core";
import { afterEach, describe, expect, it } from "vitest";
import { launchWithPageNetwork, type PageNetworkLaunch } from "./pageNetwork.js";

const previous = process.env.PRODUCER_RESTRICT_PAGE_NETWORK;

afterEach(() => {
  if (previous === undefined) delete process.env.PRODUCER_RESTRICT_PAGE_NETWORK;
  else process.env.PRODUCER_RESTRICT_PAGE_NETWORK = previous;
});

/** A browser double: connected until `disconnect()`, which fires puppeteer's "disconnected" event. */
function fakeBrowser() {
  const events = new EventEmitter();
  const browser = {
    connected: true,
    once: (event: string, listener: () => void) => events.once(event, listener),
  };
  return {
    browser: browser as unknown as Browser,
    disconnect() {
      browser.connected = false;
      events.emit("disconnected");
    },
  };
}

describe("launchWithPageNetwork", () => {
  it("adds nothing when the page network isn't restricted", async () => {
    delete process.env.PRODUCER_RESTRICT_PAGE_NETWORK;
    let seen: PageNetworkLaunch | undefined;
    const { browser } = fakeBrowser();
    await launchWithPageNetwork("http://127.0.0.1:4000/", async (network) => {
      seen = network;
      return browser;
    });
    expect(seen).toEqual({ args: [] });
  });

  // fails without the fix: layout, validate and the motion shot launched Chrome with no proxy when the page
  // network was restricted.
  it("routes everything but the page server through a public-only proxy for the browser's life", async () => {
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
    let seen: PageNetworkLaunch | undefined;
    const fake = fakeBrowser();
    await launchWithPageNetwork("http://127.0.0.1:4000/index.html", async (network) => {
      seen = network;
      return fake.browser;
    });
    const proxyArg = seen?.args.find((arg) => arg.startsWith("--proxy-server="));
    expect(proxyArg).toMatch(/^--proxy-server=http:\/\/127\.0\.0\.1:\d+$/);
    expect(seen?.args).toContain("--proxy-bypass-list=<-loopback>;127.0.0.1:4000");
    expect(seen?.args).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
    expect(seen?.userDataDir && existsSync(seen.userDataDir)).toBe(true);

    const proxyUrl = proxyArg!.slice("--proxy-server=".length);
    expect(
      await fetch(proxyUrl).then(
        () => "open",
        () => "closed",
      ),
    ).toBe("open");

    fake.disconnect();
    await expect
      .poll(() =>
        fetch(proxyUrl).then(
          () => "open",
          () => "closed",
        ),
      )
      .toBe("closed");
    await expect.poll(() => existsSync(seen!.userDataDir!)).toBe(false);
  });

  // fails without the fix: a page server on the default port gave a bypass entry with no port, which admits
  // every port on that host.
  it("names the page server's port in the bypass entry even when the URL leaves it out", async () => {
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
    let seen: PageNetworkLaunch | undefined;
    const fake = fakeBrowser();
    await launchWithPageNetwork("http://localhost/index.html", async (network) => {
      seen = network;
      return fake.browser;
    });
    expect(seen?.args).toContain("--proxy-bypass-list=<-loopback>;localhost:80");
    fake.disconnect();
    await expect.poll(() => existsSync(seen!.userDataDir!)).toBe(false);
  });

  it("refuses to launch a restricted browser before the page has a URL", async () => {
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
    let launched = false;
    await expect(
      launchWithPageNetwork(undefined, async () => {
        launched = true;
        return fakeBrowser().browser;
      }),
    ).rejects.toThrow(/needs the page's URL/);
    expect(launched).toBe(false);
  });

  it("closes the proxy when the launch fails", async () => {
    process.env.PRODUCER_RESTRICT_PAGE_NETWORK = "true";
    let seen: PageNetworkLaunch | undefined;
    await expect(
      launchWithPageNetwork("http://127.0.0.1:4000/", async (network) => {
        seen = network;
        throw new Error("chrome failed");
      }),
    ).rejects.toThrow("chrome failed");
    const proxyUrl = seen!.args.find((arg) => arg.startsWith("--proxy-server="))!.slice(15);
    expect(
      await fetch(proxyUrl).then(
        () => "open",
        () => "closed",
      ),
    ).toBe("closed");
    expect(existsSync(seen!.userDataDir!)).toBe(false);
  });
});
