import { spawn } from "node:child_process";

export interface OpenBrowserOptions {
  browserPath?: string;
  userDataDir?: string;
  remoteDebuggingPort?: number;
}

/**
 * Validate and parse a --remote-debugging-port value.
 * Returns the port number or undefined if not provided.
 * Throws if the value is not a valid integer in 1..65535.
 */
export function parseRemoteDebuggingPort(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;

  const text = String(value);

  if (!/^\d+$/.test(text)) {
    throw new Error("--remote-debugging-port must be an integer between 1 and 65535");
  }

  const port = Number(text);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("--remote-debugging-port must be an integer between 1 and 65535");
  }

  return port;
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
  if (options.remoteDebuggingPort !== undefined) {
    args.push(`--remote-debugging-port=${options.remoteDebuggingPort}`);
  }
  args.push(url);
  return args;
}

/**
 * Open a URL in the browser with the given options.
 *
 * - browserPath: spawn the given binary directly (enables Chromium flags)
 * - userDataDir: passed as --user-data-dir (requires browserPath)
 * - remoteDebuggingPort: passed as --remote-debugging-port (requires browserPath + userDataDir)
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
