import { runRenderSetupWorker } from "../utils/cancellableProcess.js";
import { parseInstallLine } from "./installProtocol.js";

type InstallOptions = import("@puppeteer/browsers").InstallOptions;

export type ChildInstallInput = Pick<
  InstallOptions,
  "cacheDir" | "browser" | "buildId" | "platform" | "baseUrl"
> & { unpack?: false };

interface InstalledPaths {
  path: string;
  executablePath: string;
}

interface InstallHooks {
  stallMs: number;
  host: string;
  onProgress?: (downloadedBytes: number, totalBytes: number) => void;
  onLog: (line: string) => void;
}

const CHILD_STARTUP_MS = 15_000;

export class BrowserDownloadStalledError extends Error {}

function lineReader(onLine: (line: string) => void): (chunk: string) => void {
  let pending = "";
  return (chunk) => {
    const lines = (pending + chunk).split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  };
}

/**
 * install() takes no abort signal and keeps its sockets open, so it runs in its own process: a stall
 * kills that process and the OS closes the sockets, with nothing in this one left to clean up.
 */
export async function installInChild(
  input: ChildInstallInput & { unpack: false },
  hooks: InstallHooks,
): Promise<string>;
export async function installInChild(
  input: ChildInstallInput,
  hooks: InstallHooks,
): Promise<InstalledPaths>;
export async function installInChild(
  input: ChildInstallInput,
  hooks: InstallHooks,
): Promise<string | InstalledPaths> {
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const arm = (waitMs: number) => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        abort.abort(
          new BrowserDownloadStalledError(
            `The Chrome download from ${hooks.host} stalled: no data for ${hooks.stallMs / 1000}s.`,
          ),
        ),
      waitMs,
    );
    timer.unref();
  };
  const onStdout = lineReader((line) => {
    const event = parseInstallLine(line);
    if (event?.kind === "log") hooks.onLog(event.text);
    if (event?.kind !== "progress") return;
    if (event.total > 0) hooks.onProgress?.(event.downloaded, event.total);
    if (event.total > 0 && event.downloaded >= event.total) clearTimeout(timer);
    else arm(hooks.stallMs);
  });
  arm(CHILD_STARTUP_MS + hooks.stallMs);
  try {
    return await runRenderSetupWorker<string | InstalledPaths>("browser-install", input, {
      signal: abort.signal,
      detached: false,
      maxBufferBytes: 4 * 1024 * 1024,
      onStdout,
    });
  } finally {
    clearTimeout(timer);
  }
}
