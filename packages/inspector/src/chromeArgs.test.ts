import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetChromeSandboxFallbackForTests, NO_SANDBOX_ARGS } from "../../core/src/chromeSandbox";
import { inspectorChromeArgs, launchInspectorChrome } from "./service";

const launch = vi.hoisted(() => vi.fn());
vi.mock("puppeteer-core", () => ({ default: { launch } }));

afterEach(() => {
  launch.mockReset();
  _resetChromeSandboxFallbackForTests();
});

describe("the inspector's Chrome", () => {
  it("drops the sandbox where the host can't give one, so it starts as root or in a container", () => {
    expect(inspectorChromeArgs(["--proxy-server=x"], false)).toEqual(
      expect.arrayContaining([...NO_SANDBOX_ARGS, "--proxy-server=x"]),
    );
  });

  it("keeps the sandbox where the host allows it", () => {
    const args = inspectorChromeArgs([], true);
    for (const flag of NO_SANDBOX_ARGS) expect(args).not.toContain(flag);
  });

  it.skipIf(process.platform !== "linux")(
    "starts without the sandbox when Chrome refuses it, as the render does",
    async () => {
      launch.mockRejectedValueOnce(new Error("No usable sandbox!")).mockResolvedValue({});
      await launchInspectorChrome({
        executablePath: "/chrome",
        userDataDir: "/profile",
        proxyArgs: [],
        sandbox: true,
      });
      const sandboxOff = launch.mock.calls.map(([options]) =>
        options.args.includes("--no-sandbox"),
      );
      expect(sandboxOff).toEqual([false, true]);
    },
  );
});
