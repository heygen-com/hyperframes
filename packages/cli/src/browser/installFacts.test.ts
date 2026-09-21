import { describe, expect, it } from "vitest";
import { describeBrowserInstall } from "./installFacts.js";

describe("describeBrowserInstall", () => {
  it("reads the build and drive from a Windows managed-cache path", () => {
    const path =
      "D:\\Users\\a\\.cache\\hyperframes\\chrome-headless-shell\\win64-152.0.7928.2\\chrome-headless-shell.exe";
    expect(describeBrowserInstall(path)).toEqual({
      build: "152.0.7928.2",
      pathAscii: true,
      pathLength: "under_120",
      drive: "windows_other",
    });
  });

  it("does not mistake an IP-shaped or version-shaped directory for a build", () => {
    expect(describeBrowserInstall("/home/10.0.0.1/apps/1.2.3.4/chrome").build).toBeUndefined();
    const cached = "/home/u/.cache/puppeteer/chrome/linux-150.0.7422.0/chrome-linux64/chrome";
    expect(describeBrowserInstall(cached).build).toBe("150.0.7422.0");
  });

  it("puts each length bucket edge on the documented side", () => {
    const at = (n: number) => describeBrowserInstall(`/${"a".repeat(n - 1)}`).pathLength;
    expect([at(119), at(120), at(199), at(200), at(259), at(260)]).toEqual([
      "under_120",
      "120_to_199",
      "120_to_199",
      "200_to_259",
      "200_to_259",
      "260_plus",
    ]);
  });

  it("flags a non-ASCII path and a UNC share", () => {
    expect(describeBrowserInstall("\\\\host\\share\\Мой\\chrome.exe")).toMatchObject({
      pathAscii: false,
      drive: "unc",
    });
  });

  it("omits the build for a system Chrome and buckets a long POSIX path", () => {
    const facts = describeBrowserInstall(`/${"a".repeat(270)}/chrome`);
    expect(facts).toEqual({ pathAscii: true, pathLength: "260_plus", drive: "posix" });
  });

  it.each([
    ["C:\\Program Files\\Google\\Chrome\\chrome.exe", "windows_c"],
    ["c:/chrome/chrome.exe", "windows_c"],
    ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "posix"],
  ] as const)("classifies the drive of %s", (path, drive) => {
    expect(describeBrowserInstall(path).drive).toBe(drive);
  });
});
