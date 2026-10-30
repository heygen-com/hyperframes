import { debuglog } from "node:util";
import { installLogLine, installProgressLine } from "./installProtocol.js";
import type { ChildInstallInput } from "./installInChild.js";

const PROGRESS_EVERY_MS = 100;

/** Runs in the install child: reports progress and unzip log lines on stdout, returns what install() produced. */
export async function runBrowserInstall(input: ChildInstallInput): Promise<unknown> {
  const { install } = await import("@puppeteer/browsers");
  let lastReport = 0;
  process.stdout.write(installProgressLine(0, 0));
  const { unpack, ...rest } = input;
  const options = {
    ...rest,
    downloadProgressCallback: (downloaded: number, total: number) => {
      const now = Date.now();
      if (now - lastReport < PROGRESS_EVERY_MS && downloaded < total) return;
      lastReport = now;
      process.stdout.write(installProgressLine(downloaded, total));
    },
    logger: (prefix: string) => {
      const debug = debuglog(prefix);
      const isUnzip = prefix === "puppeteer:browsers:fileUtil";
      if (!isUnzip && !debug.enabled) return undefined;
      return (...args: unknown[]) => {
        const line = args.join(" ");
        if (isUnzip) process.stdout.write(installLogLine(line));
        if (debug.enabled) debug(line);
      };
    },
  };
  if (unpack === false) return install({ ...options, unpack: false });
  const { path, executablePath } = await install(options);
  return { path, executablePath };
}
