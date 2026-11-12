import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetChromeSandboxFallbackForTests,
  chromeSandboxEnabled,
  launchWithChromeSandboxFallback,
  NO_SANDBOX_ARGS,
  type ChromeSandboxHost,
} from "./chromeSandbox.js";
import { buildChromeArgs } from "./browserManager.js";

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

const withFile = (path: string) => (candidate: string) => candidate === path;
const withSysctl = (path: string, value: string) => (candidate: string) =>
  candidate === path ? value : undefined;

describe("chromeSandboxEnabled", () => {
  it.each(["darwin", "win32"] as const)("keeps the sandbox on %s", (platform) => {
    expect(chromeSandboxEnabled(host({ platform }))).toBe(true);
    expect(chromeSandboxEnabled(host({ platform, uid: 0 }))).toBe(true);
  });

  it("keeps the sandbox for a non-root Linux user outside containers", () => {
    expect(chromeSandboxEnabled(host())).toBe(true);
    expect(
      chromeSandboxEnabled(
        host({ read: withSysctl("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "0") }),
      ),
    ).toBe(true);
  });

  it.each<[string, Partial<ChromeSandboxHost>]>([
    ["root", { uid: 0 }],
    ["AWS Lambda", { env: { AWS_LAMBDA_FUNCTION_NAME: "render" } }],
    ["the Lambda runtime", { env: { AWS_EXECUTION_ENV: "AWS_Lambda_nodejs22.x" } }],
    ["a Cloud Run service", { env: { K_SERVICE: "renderer" } }],
    ["a Cloud Run job", { env: { CLOUD_RUN_JOB: "renderer" } }],
    ["Kubernetes", { env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" } }],
    ["Docker", { exists: withFile("/.dockerenv") }],
    ["Podman", { exists: withFile("/run/.containerenv") }],
    [
      "AppArmor-restricted user namespaces",
      { read: withSysctl("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "1") },
    ],
    [
      "disabled user namespaces",
      { read: withSysctl("/proc/sys/kernel/unprivileged_userns_clone", "0") },
    ],
  ])("drops the sandbox on Linux under %s", (_, overrides) => {
    expect(chromeSandboxEnabled(host(overrides))).toBe(false);
  });

  it("lets HYPERFRAMES_CHROME_SANDBOX override detection", () => {
    expect(chromeSandboxEnabled(host({ uid: 0, env: { HYPERFRAMES_CHROME_SANDBOX: "1" } }))).toBe(
      true,
    );
    expect(
      chromeSandboxEnabled(host({ platform: "darwin", env: { HYPERFRAMES_CHROME_SANDBOX: "0" } })),
    ).toBe(false);
    expect(chromeSandboxEnabled(host({ env: { HYPERFRAMES_CHROME_SANDBOX: "yes" } }))).toBe(true);
  });
});

describe("buildChromeArgs sandbox flags", () => {
  const base = { width: 320, height: 240, platform: "linux" as const };

  it("omits every no-sandbox flag, --no-zygote included, when the sandbox is on", () => {
    const args = buildChromeArgs({ ...base, sandbox: true });
    for (const flag of NO_SANDBOX_ARGS) expect(args).not.toContain(flag);
  });

  it("keeps --no-zygote alongside --no-sandbox when the sandbox is off", () => {
    expect(buildChromeArgs({ ...base, sandbox: false })).toEqual(
      expect.arrayContaining(["--no-sandbox", "--disable-setuid-sandbox", "--no-zygote"]),
    );
  });
});

describe("launchWithChromeSandboxFallback", () => {
  const closedTarget = Object.assign(new Error("Protocol error: Target closed"), {
    name: "TargetCloseError",
  });
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetChromeSandboxFallbackForTests();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("retries a bare startup exit once without the sandbox, warns once, and latches on the second", async () => {
    const launch = vi
      .fn<(args: string[]) => Promise<string>>()
      .mockRejectedValueOnce(closedTarget)
      .mockResolvedValueOnce("browser")
      .mockRejectedValueOnce(closedTarget)
      .mockResolvedValue("browser");

    await expect(launchWithChromeSandboxFallback(["--a"], launch, "linux", {})).resolves.toBe(
      "browser",
    );
    await launchWithChromeSandboxFallback(["--a"], launch, "linux", {});
    await launchWithChromeSandboxFallback(["--a"], launch, "linux", {});

    expect(launch.mock.calls.map(([args]) => args)).toEqual([
      ["--a"],
      ["--a", ...NO_SANDBOX_ARGS],
      ["--a"],
      ["--a", ...NO_SANDBOX_ARGS],
      ["--a", ...NO_SANDBOX_ARGS],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("latches at once when Chrome names the sandbox in its error", async () => {
    const launch = vi
      .fn<(args: string[]) => Promise<string>>()
      .mockRejectedValueOnce(new Error("Failed to launch the browser process: No usable sandbox!"))
      .mockResolvedValue("browser");
    await expect(launchWithChromeSandboxFallback([], launch, "linux", {})).resolves.toBe("browser");
    await launchWithChromeSandboxFallback([], launch, "linux", {});
    expect(launch.mock.calls.map(([args]) => args)).toEqual([[], NO_SANDBOX_ARGS, NO_SANDBOX_ARGS]);
  });

  it("never drops the sandbox when HYPERFRAMES_CHROME_SANDBOX=1 requires it", async () => {
    const refused = new Error("Running as root without --no-sandbox is not supported");
    const launch = vi.fn<(args: string[]) => Promise<string>>().mockRejectedValue(refused);
    const env = { HYPERFRAMES_CHROME_SANDBOX: "1" };
    await expect(launchWithChromeSandboxFallback([], launch, "linux", env)).rejects.toBe(refused);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, string[], NodeJS.Platform, Error]>([
    ["an unrelated failure", [], "linux", new Error("spawn ENOENT")],
    ["an unsandboxed launch", ["--no-sandbox"], "linux", closedTarget],
    ["macOS", [], "darwin", closedTarget],
    ["Windows", [], "win32", closedTarget],
  ])("does not retry %s", async (_, args, platform, error) => {
    const launch = vi.fn<(args: string[]) => Promise<string>>().mockRejectedValue(error);
    await expect(launchWithChromeSandboxFallback(args, launch, platform, {})).rejects.toBe(error);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("surfaces the retry's own failure and tries the sandbox again next time", async () => {
    const retryError = new Error("retry failed");
    const launch = vi
      .fn<(args: string[]) => Promise<string>>()
      .mockRejectedValueOnce(closedTarget)
      .mockRejectedValueOnce(retryError)
      .mockResolvedValue("browser");
    await expect(launchWithChromeSandboxFallback([], launch, "linux", {})).rejects.toBe(retryError);
    await launchWithChromeSandboxFallback([], launch, "linux", {});
    expect(launch).toHaveBeenLastCalledWith([]);
  });
});
