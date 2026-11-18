import { afterEach, expect, it, vi } from "vitest";
import { _resetChromeSandboxFallbackForTests } from "@hyperframes/core/chrome-sandbox";
import { launchVerifyBrowser } from "./verifyStaticPage.js";

const launch = vi.hoisted(() => vi.fn());
vi.mock("puppeteer", () => ({ default: { launch } }));

afterEach(() => {
  launch.mockReset();
  _resetChromeSandboxFallbackForTests();
});

it.skipIf(process.platform !== "linux")(
  "the page check starts without the sandbox when Chrome refuses it, as the render does",
  async () => {
    launch.mockRejectedValueOnce(new Error("No usable sandbox!")).mockResolvedValue({});
    await launchVerifyBrowser(true);
    const sandboxOff = launch.mock.calls.map(([options]) => options.args.includes("--no-sandbox"));
    expect(sandboxOff).toEqual([false, true]);
  },
);
