import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCaptureSession } from "./frameCapture.js";

const chrome = vi.hoisted(() => ({ connected: true, tabsLost: 0, opened: [] as object[] }));

/** A page whose tab Chrome closed during setup: puppeteer resolves it, then every call throws. */
const lostTab = () => ({
  mainFrame: () => {
    throw new Error("Requesting main frame too early!");
  },
  close: vi.fn(async () => {}),
});
const liveTab = () => ({
  mainFrame: () => ({}),
  close: vi.fn(async () => {}),
  on: () => {},
  goto: async () => null,
  createCDPSession: async () => ({ on: () => {}, send: async () => ({}) }),
  evaluateOnNewDocument: async () => {},
  setViewport: async () => {},
  evaluate: async () => undefined,
});

vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveBrowserGpuMode: async () => "hardware",
  acquireBrowser: async () => ({
    captureMode: "screenshot",
    release: async () => {},
    forceRelease: () => {},
    browser: {
      get connected() {
        return chrome.connected;
      },
      process: () => ({ exitCode: chrome.connected ? null : 9, signalCode: null }),
      version: async () => "Chrome/150.0.0.0",
      newPage: async () => {
        const page = chrome.opened.length < chrome.tabsLost ? lostTab() : liveTab();
        chrome.opened.push(page);
        return page;
      },
    },
  }),
}));

const dirs: string[] = [];
afterEach(() => {
  Object.assign(chrome, { connected: true, tabsLost: 0, opened: [] });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function session() {
  const dir = mkdtempSync(join(tmpdir(), "hf-tab-lost-"));
  dirs.push(dir);
  return createCaptureSession(
    "http://localhost:0",
    dir,
    { width: 640, height: 360, fps: { num: 30, den: 1 }, format: "jpeg" },
    null,
    { forceScreenshot: true },
  );
}

describe("a capture page whose tab Chrome closed while opening it", () => {
  // fails without the fix: the session used the dead page and threw "Requesting main frame too early!".
  it("captures on one more page while the browser still runs", async () => {
    chrome.tabsLost = 1;

    const created = await session();

    expect(created.page).toBe(chrome.opened[1]);
    expect(vi.mocked((chrome.opened[0] as { close(): Promise<void> }).close)).toHaveBeenCalled();
  });

  it("says the browser is still running when the second tab is lost too", async () => {
    chrome.tabsLost = 2;

    await expect(session()).rejects.toThrow(
      "Chrome closed the render page's tab while opening it, twice; the browser is still running",
    );
    expect(chrome.opened).toHaveLength(2);
  });

  it("says Chrome exited, with its exit code, and opens nothing more", async () => {
    chrome.tabsLost = 1;
    chrome.connected = false;

    await expect(session()).rejects.toThrow(
      "Chrome exited while opening a render page (exit code 9, signal none)",
    );
    expect(chrome.opened).toHaveLength(1);
  });
});
