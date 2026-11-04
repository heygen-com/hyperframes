import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  proxyClose: vi.fn(),
  browserClose: vi.fn(),
  once: vi.fn(),
  launch: vi.fn(),
}));
vi.mock("./captureProxy.js", () => ({
  startCaptureProxy: async () => ({ url: "http://127.0.0.1:4567", close: mocks.proxyClose }),
}));
vi.mock("../browser/launch.js", () => ({
  launchManagedBrowser: mocks.launch,
  closeManagedBrowser: mocks.browserClose,
  registerBrowserSessionCleanup: () => () => {},
}));
vi.mock("puppeteer-core", () => ({ default: {} }));
import { launchCaptureBrowser } from "./launchCaptureBrowser.js";
const options = {
  executablePath: "/chrome",
  protocolTimeout: 1000,
  disableWebgl: false,
  width: 800,
  height: 600,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.proxyClose.mockResolvedValue(undefined);
  mocks.browserClose.mockResolvedValue(undefined);
  mocks.launch.mockResolvedValue({
    close: mocks.browserClose,
    once: mocks.once,
    newPage: vi.fn(),
  });
});
describe("capture browser transport lifecycle", () => {
  it("forces proxy for loopback and disables direct UDP routes", async () => {
    const session = await launchCaptureBrowser(options);
    expect(mocks.launch.mock.calls[0]?.[1].args).toEqual(
      expect.arrayContaining([
        "--proxy-server=http://127.0.0.1:4567",
        "--proxy-bypass-list=<-loopback>",
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ]),
    );
    const profile = mocks.launch.mock.calls[0]?.[1].userDataDir;
    expect(JSON.parse(readFileSync(join(profile, "Default", "Preferences"), "utf8"))).toEqual({
      webrtc: { ip_handling_policy: "disable_non_proxied_udp" },
    });
    await session.close();
    expect(existsSync(profile)).toBe(false);
    expect(mocks.proxyClose.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      mocks.browserClose.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("exempts only a local page server's exact host and port from the proxy", async () => {
    const session = await launchCaptureBrowser({
      ...options,
      localOrigin: "http://127.0.0.1:9123",
    });
    expect(mocks.launch.mock.calls[0]?.[1].args).toContain(
      "--proxy-bypass-list=<-loopback>;127.0.0.1:9123",
    );
    await session.close();
  });

  // A profile directory the OS refuses to empty stands in for Windows' locked Chrome lockfile.
  it.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
    "finishes a close whose profile directory cannot be removed, with a warning",
    async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const session = await launchCaptureBrowser(options);
      const profile = mocks.launch.mock.calls[0]?.[1].userDataDir;
      const locked = join(profile, "Default");
      chmodSync(locked, 0o500);
      try {
        await expect(session.close()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(profile));
      } finally {
        chmodSync(locked, 0o700);
        warn.mockRestore();
      }
    },
  );

  it("closes proxy when launch fails", async () => {
    mocks.launch.mockRejectedValue(new Error("launch failed"));
    await expect(launchCaptureBrowser(options)).rejects.toThrow("launch failed");
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
  });
  it("closes proxy before a failing browser shutdown", async () => {
    const session = await launchCaptureBrowser(options);
    mocks.browserClose.mockRejectedValue(new Error("close failed"));
    await expect(session.close()).rejects.toThrow("close failed");
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
  });
  it("closes proxy on unexpected browser disconnect", async () => {
    const session = await launchCaptureBrowser(options);
    const [event, callback] = mocks.once.mock.calls[0] ?? [];
    expect(event).toBe("disconnected");
    callback();
    expect(mocks.proxyClose).toHaveBeenCalledOnce();
    await session.close();
  });
});

describe("pages the capture browser opens", () => {
  it("ride out a navigation that destroys the execution context mid-read", async () => {
    const evaluate = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Execution context was destroyed, most likely because of a navigation."),
      )
      .mockResolvedValue("ok");
    const rawPage = { evaluate, waitForNetworkIdle: vi.fn(async () => undefined) };
    mocks.launch.mockResolvedValue({
      close: mocks.browserClose,
      once: mocks.once,
      newPage: vi.fn(async () => rawPage),
    });
    const session = await launchCaptureBrowser(options);
    const page = await session.browser.newPage();
    await expect(page.evaluate(() => "read")).resolves.toBe("ok");
    await session.close();
  });
});
