import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  newPage: vi.fn(async () => ({
    setViewport: async () => undefined,
    goto: async () => undefined,
    evaluate: async () => undefined,
  })),
}));

vi.mock("@hyperframes/core/compiler", () => ({
  bundleToSingleHtml: async () => '<div data-composition-id="main"></div>',
}));
vi.mock("@hyperframes/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hyperframes/engine")>()),
  buildChromeArgs: () => [],
}));
vi.mock("../browser/manager.js", () => ({
  ensureBrowser: async () => ({ executablePath: "/chrome" }),
}));
vi.mock("../utils/staticProjectServer.js", () => ({
  serveStaticProjectHtml: async () => ({ url: "http://127.0.0.1:1/", close: async () => {} }),
}));
vi.mock("../browser/launch.js", () => ({
  launchManagedBrowser: async () => browser,
  resolveManagedGpuMode: async () => "software",
}));
vi.mock("../capture/captureCompositionFrame.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../capture/captureCompositionFrame.js")>()),
  waitForRuntimeReady: async () => {
    throw new Error("HyperFrames runtime failed: Error: boom.");
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

it("closes the browser when the runtime fails to start, so the command exits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hf-motion-shot-"));
  try {
    const { captureMotionPathShot } = await import("./motionShot.js");

    await expect(
      captureMotionPathShot(dir, [{ selector: "#box" }], join(dir, "out.png")),
    ).rejects.toThrow("HyperFrames runtime failed");

    expect(browser.close).toHaveBeenCalled();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
