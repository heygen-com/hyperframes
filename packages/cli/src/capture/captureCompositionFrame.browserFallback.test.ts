import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureBrowser: vi.fn(),
  findSystemBrowser: vi.fn(),
  launch: vi.fn(),
  buildChromeArgs: vi.fn(() => []),
  resolveBrowserGpuMode: vi.fn(async () => "software" as const),
}));

vi.mock("../browser/manager.js", () => ({
  ensureBrowser: mocks.ensureBrowser,
  findSystemBrowser: mocks.findSystemBrowser,
}));

vi.mock("puppeteer-core", () => ({ default: { launch: mocks.launch } }));

vi.mock("@hyperframes/engine", () => ({
  buildChromeArgs: mocks.buildChromeArgs,
  resolveBrowserGpuMode: mocks.resolveBrowserGpuMode,
}));

import { openSettledCompositionPage } from "./captureCompositionFrame.js";

const HTML = '<div data-composition-id="main" data-width="1920" data-height="1080"></div>';
const OPTIONS = {
  renderReadyTimeoutMs: 1000,
  renderReadyWarningSuffix: "test",
  browserGpuMode: "software" as const,
};
const BUNDLED = "C:\\hyperframes\\chrome-headless-shell.exe";
const SYSTEM = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function launchCrash(): Error {
  return new Error("Failed to launch the browser process! Code: 3221225595");
}

function fakeBrowser() {
  const page = {
    evaluateOnNewDocument: vi.fn(async () => undefined),
    setViewport: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    waitForFunction: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => undefined),
  };
  return {
    browser: {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    },
    page,
  };
}

describe("openSettledCompositionPage Windows bundled-browser recovery", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

  beforeEach(() => {
    vi.resetAllMocks();
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    mocks.ensureBrowser.mockResolvedValue({ executablePath: BUNDLED, source: "cache" });
    mocks.findSystemBrowser.mockReturnValue({ executablePath: SYSTEM, source: "system" });
    mocks.buildChromeArgs.mockReturnValue([]);
    mocks.resolveBrowserGpuMode.mockResolvedValue("software");
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalPlatform) Object.defineProperty(process, "platform", originalPlatform);
  });

  it("retries the known managed-shell crash once with system Chrome", async () => {
    const fallback = fakeBrowser();
    mocks.launch.mockRejectedValueOnce(launchCrash()).mockResolvedValueOnce(fallback.browser);

    const session = await openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS);

    expect(mocks.launch).toHaveBeenCalledTimes(2);
    expect(mocks.launch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ executablePath: BUNDLED }),
    );
    expect(mocks.launch.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ executablePath: SYSTEM }),
    );
    expect(session.browser).toBe(fallback.browser);
  });

  it("adds STATUS_STACK_BUFFER_OVERRUN and browser-path guidance when no system Chrome exists", async () => {
    mocks.findSystemBrowser.mockReturnValue(undefined);
    mocks.launch.mockRejectedValueOnce(launchCrash());

    await expect(
      openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS),
    ).rejects.toThrow(/STATUS_STACK_BUFFER_OVERRUN[\s\S]*HYPERFRAMES_BROWSER_PATH/);
    expect(mocks.launch).toHaveBeenCalledOnce();
  });

  it("keeps unrelated launch errors unchanged", async () => {
    const error = new Error("Failed to launch the browser process! Code: 1");
    mocks.launch.mockRejectedValueOnce(error);

    await expect(openSettledCompositionPage(HTML, "http://127.0.0.1:3000", OPTIONS)).rejects.toBe(
      error,
    );
    expect(mocks.findSystemBrowser).not.toHaveBeenCalled();
    expect(mocks.launch).toHaveBeenCalledOnce();
  });
});
