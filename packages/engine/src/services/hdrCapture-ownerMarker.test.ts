import { HYPERFRAMES_BROWSER_MARKER_ARG } from "@hyperframes/core/browser-marker";
import type { LaunchOptions } from "puppeteer-core";
import { expect, it, vi } from "vitest";

const launch = vi.hoisted(() =>
  vi.fn(async (_options: LaunchOptions) => ({
    newPage: async () => ({ setViewport: async () => undefined }),
  })),
);
vi.mock("puppeteer", () => ({ default: { launch } }));
vi.mock("puppeteer-core", () => ({ default: { launch } }));
vi.mock("./browserManager.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./browserManager.js")>()),
  resolveFullChromePath: () => "/opt/chrome/chrome",
}));

const { launchHdrBrowser } = await import("./hdrCapture.js");

it("marks the HDR browser", async () => {
  await launchHdrBrowser(64, 64);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch.mock.calls[0]![0].args).toContain(HYPERFRAMES_BROWSER_MARKER_ARG);
});
