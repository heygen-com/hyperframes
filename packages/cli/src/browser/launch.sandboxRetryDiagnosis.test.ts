import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaunchOptions, PuppeteerNode } from "puppeteer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launchManagedBrowser } from "./launch.js";

/** A browser that prints the flags it was started with and exits. */
function argvEchoingBrowser(): string {
  const path = join(mkdtempSync(join(tmpdir(), "hf-fake-chrome-")), "chrome");
  writeFileSync(
    path,
    "#!/usr/bin/env node\nconsole.error(process.argv.slice(2).join(' ')); process.exit(3);\n",
  );
  chmodSync(path, 0o755);
  return path;
}

const closedTarget = () =>
  Object.assign(new Error("Protocol error: Target closed"), { name: "TargetCloseError" });

describe.runIf(process.platform === "linux")(
  "the startup diagnosis after a sandboxed launch and its retry both fail",
  () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it("starts the diagnosis with the retry's flags, which produced the surfaced error", async () => {
      vi.stubEnv("HYPERFRAMES_CHROME_SANDBOX", "");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const real = (await import("puppeteer-core")).default;
      const launches: LaunchOptions[] = [];
      const puppeteer = {
        launch: async (options: LaunchOptions) => {
          launches.push(options);
          throw closedTarget();
        },
        defaultArgs: (options: Parameters<PuppeteerNode["defaultArgs"]>[0]) =>
          real.defaultArgs(options),
      } as unknown as PuppeteerNode;

      const failure = await launchManagedBrowser(puppeteer, {
        executablePath: argvEchoingBrowser(),
        headless: true,
        args: ["--headless"],
      }).then(
        () => undefined,
        (error: unknown) => error as Error,
      );

      expect(launches.map((options) => options.args?.includes("--no-sandbox"))).toEqual([
        false,
        true,
      ]);
      expect(failure?.message).toContain("exited with code 3");
      expect(failure?.message).toMatch(/--no-sandbox/);
    }, 60_000);

    it("starts the diagnosis with the launch's env, not process.env", async () => {
      vi.stubEnv("HYPERFRAMES_CHROME_SANDBOX", "");
      vi.stubEnv("WAYLAND_DISPLAY", "wayland-from-process-env");
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const real = (await import("puppeteer-core")).default;
      const puppeteer = {
        launch: async () => {
          throw closedTarget();
        },
        defaultArgs: (options: Parameters<PuppeteerNode["defaultArgs"]>[0]) =>
          real.defaultArgs(options),
      } as unknown as PuppeteerNode;
      const path = join(mkdtempSync(join(tmpdir(), "hf-fake-chrome-")), "chrome");
      writeFileSync(
        path,
        "#!/usr/bin/env node\nconsole.error('wayland=' + process.env.WAYLAND_DISPLAY); process.exit(3);\n",
      );
      chmodSync(path, 0o755);

      const failure = await launchManagedBrowser(puppeteer, {
        executablePath: path,
        headless: true,
        args: ["--headless"],
        env: { PATH: process.env.PATH },
      }).then(
        () => undefined,
        (error: unknown) => error as Error,
      );

      expect(failure?.message).toContain("wayland=undefined");
      expect(failure?.message).not.toContain("wayland-from-process-env");
    }, 60_000);
  },
);
