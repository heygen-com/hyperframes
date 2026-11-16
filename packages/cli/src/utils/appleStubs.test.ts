import { describe, expect, it } from "vitest";
import { runsWithoutInstallPrompt } from "./appleStubs.js";

/** A Mac whose filesystem holds exactly `files`; `link` is where xcode-select's choice points, if it made one. */
function mac(files: string[], { env = {}, link }: { env?: NodeJS.ProcessEnv; link?: string } = {}) {
  return {
    platform: "darwin" as const,
    env,
    exists: (path: string) => files.includes(path),
    executable: (path: string) => files.includes(path),
    realpath: (path: string) => (path === "/var/db/xcode_select_link" ? (link ?? null) : null),
  };
}
const TOOLS = "/Library/Developer/CommandLineTools/usr/bin";

describe("runsWithoutInstallPrompt", () => {
  it("refuses macOS's git, xcrun and cc stubs when no developer tools are installed", () => {
    for (const command of ["/usr/bin/git", "xcrun", "/usr/bin/cc"])
      expect(runsWithoutInstallPrompt(command, mac([])), command).toBe(false);
  });

  it("runs them once the Command Line Tools are installed", () => {
    expect(runsWithoutInstallPrompt("/usr/bin/git", mac([TOOLS]))).toBe(true);
  });

  it("runs them on a Mac with only Xcode.app, where xcode-select never chose a folder", () => {
    const xcode = "/Applications/Xcode.app/Contents/Developer/usr/bin";
    for (const command of ["/usr/bin/git", "xcrun", "/usr/bin/cc"])
      expect(runsWithoutInstallPrompt(command, mac([xcode])), command).toBe(true);
  });

  it("follows the developer folder xcode-select chose, or DEVELOPER_DIR", () => {
    const xcode = "/Applications/Xcode-beta.app/Contents/Developer";
    expect(runsWithoutInstallPrompt("xcrun", mac([`${xcode}/usr/bin`], { link: xcode }))).toBe(
      true,
    );
    expect(
      runsWithoutInstallPrompt(
        "xcrun",
        mac([`${xcode}/usr/bin`], { env: { DEVELOPER_DIR: xcode } }),
      ),
    ).toBe(true);
  });

  it("runs a git outside /usr/bin, a /usr/bin tool that is no stub, and anything off macOS", () => {
    expect(runsWithoutInstallPrompt("/opt/homebrew/bin/git", mac([]))).toBe(true);
    expect(runsWithoutInstallPrompt("/usr/bin/which", mac([]))).toBe(true);
    expect(runsWithoutInstallPrompt("/usr/bin/git", { ...mac([]), platform: "linux" })).toBe(true);
  });
});

describe("runsWithoutInstallPrompt with a bare name", () => {
  it("runs the first executable on PATH, found without running anything", () => {
    const env = { PATH: "/opt/homebrew/bin:/usr/bin" };
    const brew = mac(["/opt/homebrew/bin/git", "/usr/bin/git"], { env });
    expect(runsWithoutInstallPrompt("git", brew)).toBe(true);
    expect(runsWithoutInstallPrompt("git", mac(["/usr/bin/git"], { env }))).toBe(false);
  });
});
