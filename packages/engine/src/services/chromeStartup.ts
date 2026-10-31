import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTreeBestEffort } from "@hyperframes/core/remove-tree";

const STDERR_TAIL_LINES = 8;
const PROBE_TIMEOUT_MS = 8_000;

// NTSTATUS codes a Windows process dies with before it can print anything.
const WINDOWS_EXITS: ReadonlyArray<readonly [number, string]> = [
  [0xc0000135, "0xC0000135: a required runtime or DLL is missing (Visual C++ runtime)."],
  [0xc0000017, "0xC0000017: Windows had no memory to start it (out of memory)."],
  [0xc0000142, "0xC0000142: a DLL failed to initialise, often security software blocking it."],
  [0xc0000022, "0xC0000022: access denied, often antivirus or a policy blocking the executable."],
  [0xc000007b, "0xC000007B: the executable and a DLL do not match (32-bit and 64-bit)."],
];

/** Names an exit code the way a person can act on it; undefined when it has no name. */
export function nameChromeExit(
  code: number | null,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32" || code === null) return undefined;
  const unsigned = code >>> 0;
  return WINDOWS_EXITS.find(([known]) => known === unsigned)?.[1];
}

function startupArgs(args: readonly string[], profile: string): string[] {
  const kept = args.filter(
    (arg) =>
      arg.startsWith("--") &&
      !arg.startsWith("--remote-debugging") &&
      !arg.startsWith("--user-data-dir"),
  );
  return [...kept, `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"];
}

function tail(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-STDERR_TAIL_LINES)
    .join("\n");
}

/** Starts the browser once more with the failed launch's flags and says how it ended. */
export async function diagnoseChromeStartup(
  executablePath: string,
  args: readonly string[],
  options: { timeoutMs?: number; platform?: NodeJS.Platform; signal?: AbortSignal } = {},
): Promise<string> {
  const profile = mkdtempSync(join(tmpdir(), "hf-chrome-probe-"));
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  try {
    return await new Promise<string>((resolve) => {
      let stderr = "";
      const child = spawn(executablePath, startupArgs(args, profile), {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        child.kill();
        resolve(`Chrome started and kept running for ${timeoutMs} ms when launched on its own.`);
      }, timeoutMs);
      options.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          child.kill();
          resolve("The startup check was cancelled.");
        },
        { once: true },
      );
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        resolve(`Chrome could not be started: ${error.message}`);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        const how = signal ? `was stopped by ${signal}` : `exited with code ${code}`;
        const named = nameChromeExit(code, options.platform);
        const lines = tail(stderr);
        resolve(
          [`Chrome ${how} when launched on its own.`, named, lines && `stderr:\n${lines}`]
            .filter(Boolean)
            .join("\n"),
        );
      });
    });
  } finally {
    removeTreeBestEffort(profile);
  }
}

/** The launch error, with the startup diagnosis appended; the original stays as `cause`. */
export async function explainChromeLaunchFailure(
  error: unknown,
  executablePath: string | undefined,
  args: readonly string[] | undefined,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!(error instanceof Error)) return error;
  const { code, errno, syscall } = error as NodeJS.ErrnoException;
  if (code === "UNKNOWN" && syscall === "spawn")
    return new Error(
      `Windows refused to start the browser${executablePath ? ` at ${executablePath}` : ""} (error ${errno ?? "unknown"}, spawn UNKNOWN). ` +
        "Windows Application Control or security software may be blocking it, or the computer may be out of memory. " +
        "Close other apps and retry. If a policy blocks the file, allow that path or set HYPERFRAMES_BROWSER_PATH to a Chrome or Edge your policy allows; " +
        "if the file is damaged, run `hyperframes browser ensure --force` to download it again.",
      { cause: error },
    );
  if (!executablePath) return error;
  const diagnosis = await diagnoseChromeStartup(executablePath, args ?? [], { signal });
  return new Error(`${error.message}\n${diagnosis}`, { cause: error });
}
