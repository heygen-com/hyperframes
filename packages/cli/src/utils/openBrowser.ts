import { spawn } from "node:child_process";

export interface OpenBrowserOptions {
  browserPath?: string;
  userDataDir?: string;
}

/**
 * Build the argument list for spawning a browser process.
 *
 * Pure function — easy to unit-test without mocking `spawn` or `import("open")`.
 */
export function buildBrowserArgs(url: string, options: OpenBrowserOptions): string[] {
  const args: string[] = [];
  if (options.userDataDir) {
    args.push(`--user-data-dir=${options.userDataDir}`);
  }
  args.push(url);
  return args;
}

/**
 * Open a URL in the browser with the given options.
 *
 * - browserPath: spawn the given binary directly (enables Chromium flags)
 * - userDataDir: passed as --user-data-dir (requires browserPath)
 * - otherwise: fall back to the `open` package (default browser)
 */
export function openBrowser(url: string, options: OpenBrowserOptions = {}): void {
  if (options.browserPath) {
    const args = buildBrowserArgs(url, options);
    const child = spawn(options.browserPath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
    return;
  }

  import("open").then((mod) => mod.default(url)).catch(() => {});
}
