import { describe, expect, it, vi } from "vitest";
import { screenshotOnceMore } from "./snapshot.js";

const dropped = () =>
  new Error("Protocol error (Page.captureScreenshot): Unable to capture screenshot");

describe("screenshotOnceMore", () => {
  it("shoots again when Chrome drops the screenshot mid-paint", async () => {
    const shoot = vi.fn().mockRejectedValueOnce(dropped()).mockResolvedValueOnce("png");
    await expect(screenshotOnceMore(shoot)).resolves.toBe("png");
    expect(shoot).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second drop", async () => {
    const shoot = vi.fn().mockRejectedValue(dropped());
    await expect(screenshotOnceMore(shoot)).rejects.toThrow(/Unable to capture screenshot/);
    expect(shoot).toHaveBeenCalledTimes(2);
  });

  it("does not retry a screenshot that fails the same way every time", async () => {
    const zero = new Error(
      "Protocol error (Page.captureScreenshot): Cannot take screenshot with 0 width.",
    );
    const shoot = vi.fn().mockRejectedValue(zero);
    await expect(screenshotOnceMore(shoot)).rejects.toBe(zero);
    expect(shoot).toHaveBeenCalledTimes(1);
  });
});
