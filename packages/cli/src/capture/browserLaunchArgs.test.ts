import type { ChromeSandboxHost } from "@hyperframes/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetCaptureSandboxWarningForTests,
  captureBrowserArgs,
  captureSandboxEnabled,
} from "./browserLaunchArgs.js";

const NO_SANDBOX = ["--no-sandbox", "--disable-setuid-sandbox", "--no-zygote"];

function host(overrides: Partial<ChromeSandboxHost> = {}): ChromeSandboxHost {
  return {
    platform: "linux",
    env: {},
    uid: 1000,
    exists: () => false,
    read: () => undefined,
    ...overrides,
  };
}

describe("capture browser sandbox", () => {
  afterEach(() => {
    _resetCaptureSandboxWarningForTests();
    vi.restoreAllMocks();
  });

  it("keeps Chrome's sandbox on a Linux host that can give it one", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(captureSandboxEnabled(host())).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["darwin", "win32"] as const)("keeps Chrome's sandbox on %s", (platform) => {
    expect(captureSandboxEnabled(host({ platform, uid: 0 }))).toBe(true);
  });

  it.each([
    ["root", host({ uid: 0 })],
    ["a container", host({ exists: (path) => path === "/.dockerenv" })],
    ["serverless", host({ env: { AWS_LAMBDA_FUNCTION_NAME: "fn" } })],
    [
      "restricted user namespaces",
      host({
        read: (path) =>
          path === "/proc/sys/kernel/apparmor_restrict_unprivileged_userns" ? "1" : undefined,
      }),
    ],
  ])("turns the sandbox off on %s and says so once", (_label, sandboxHost) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(captureSandboxEnabled(sandboxHost)).toBe(false);
    expect(captureSandboxEnabled(sandboxHost)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("sandbox is off for website capture");
  });

  it("follows HYPERFRAMES_CHROME_SANDBOX, and an explicit 0 stays quiet", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(captureSandboxEnabled(host({ env: { HYPERFRAMES_CHROME_SANDBOX: "0" } }))).toBe(false);
    expect(captureSandboxEnabled(host({ uid: 0, env: { HYPERFRAMES_CHROME_SANDBOX: "1" } }))).toBe(
      true,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds the no-sandbox flags only when the sandbox is off", () => {
    const on = captureBrowserArgs(false, 800, 600, true);
    for (const flag of NO_SANDBOX) expect(on).not.toContain(flag);
    expect(captureBrowserArgs(false, 800, 600, false)).toEqual(expect.arrayContaining(NO_SANDBOX));
  });
});
