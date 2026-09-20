import { describe, expect, it } from "vitest";
import { captureBrowserArgs } from "./browserLaunchArgs.js";

describe("capture navigation retry launch", () => {
  it("uses the normal WebGL launch for the first attempt", () => {
    const args = captureBrowserArgs(false, 1920, 1080);
    expect(args).toContain("--enable-webgl");
    expect(args).toContain("--use-angle=swiftshader");
    expect(args).not.toContain("--disable-gpu");
  });

  it("uses only the reduced GPU launch for the retry", () => {
    const args = captureBrowserArgs(true, 1920, 1080);
    expect(args).toContain("--disable-gpu");
    expect(args).not.toContain("--enable-webgl");
    expect(args).not.toContain("--use-angle=swiftshader");
    expect(args).not.toContain("--use-gl=angle");
  });
});
