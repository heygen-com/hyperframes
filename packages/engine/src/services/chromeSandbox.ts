import { existsSync, readFileSync } from "node:fs";

export const NO_SANDBOX_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--no-zygote"];

const SANDBOX_START_FAILURE =
  /No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace/;

export interface ChromeSandboxHost {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  uid: number | undefined;
  exists: (path: string) => boolean;
  read: (path: string) => string | undefined;
}

function readTrimmed(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return undefined;
  }
}

const currentHost = (): ChromeSandboxHost => ({
  platform: process.platform,
  env: process.env,
  uid: process.getuid?.(),
  exists: existsSync,
  read: readTrimmed,
});

const SERVERLESS_OR_ORCHESTRATED_ENV = [
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_EXECUTION_ENV",
  "K_SERVICE",
  "CLOUD_RUN_JOB",
  "KUBERNETES_SERVICE_HOST",
];
const CONTAINER_MARKERS = ["/.dockerenv", "/run/.containerenv"];
const USERNS_BLOCKED_SYSCTLS: ReadonlyArray<readonly [string, string]> = [
  ["/proc/sys/kernel/apparmor_restrict_unprivileged_userns", "1"],
  ["/proc/sys/kernel/unprivileged_userns_clone", "0"],
];

function linuxCannotSandbox({ env, uid, exists, read }: ChromeSandboxHost): boolean {
  return (
    uid === 0 ||
    SERVERLESS_OR_ORCHESTRATED_ENV.some((name) => !!env[name]) ||
    CONTAINER_MARKERS.some((path) => exists(path)) ||
    USERNS_BLOCKED_SYSCTLS.some(([path, blocked]) => read(path) === blocked)
  );
}

/** Chrome keeps its sandbox unless the host can't give it one: root, serverless, a container, or blocked user namespaces. */
export function chromeSandboxEnabled(host: ChromeSandboxHost = currentHost()): boolean {
  const override = host.env.HYPERFRAMES_CHROME_SANDBOX;
  if (override === "0" || override === "1") return override === "1";
  return host.platform !== "linux" || !linuxCannotSandbox(host);
}

export function chromeSandboxArgs(sandbox = chromeSandboxEnabled()): string[] {
  return sandbox ? [] : NO_SANDBOX_ARGS;
}

function withoutChromeSandbox(args: readonly string[]): string[] {
  return [...args.filter((arg) => !NO_SANDBOX_ARGS.includes(arg)), ...NO_SANDBOX_ARGS];
}

let sandboxRefused = false;
let closedTargetRetries = 0;
let warned = false;

export function _resetChromeSandboxFallbackForTests(): void {
  sandboxRefused = false;
  closedTargetRetries = 0;
  warned = false;
}

function chromeNamedSandboxFailure(error: unknown): boolean {
  return error instanceof Error && SANDBOX_START_FAILURE.test(error.message);
}

function sandboxStartFailure(error: unknown): boolean {
  // Over a pipe, a Chrome that exits at startup surfaces only as a closed target.
  return (
    chromeNamedSandboxFailure(error) ||
    (error instanceof Error && error.name === "TargetCloseError")
  );
}

/**
 * A sandboxed Linux launch Chrome refuses at startup is retried once without the sandbox.
 * The sandbox stays off for the process once Chrome names it as the cause, or after a second
 * bare startup exit (a single one may be an unrelated kill). HYPERFRAMES_CHROME_SANDBOX=1 never retries.
 */
export async function launchWithChromeSandboxFallback<T>(
  args: readonly string[],
  launch: (args: string[]) => Promise<T>,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const sandboxed = platform === "linux" && !args.includes("--no-sandbox");
  const sandboxRequired = env.HYPERFRAMES_CHROME_SANDBOX === "1";
  if (sandboxed && sandboxRefused && !sandboxRequired) return launch(withoutChromeSandbox(args));
  try {
    return await launch([...args]);
  } catch (error) {
    if (!sandboxed || sandboxRequired || !sandboxStartFailure(error)) throw error;
    const browser = await launch(withoutChromeSandbox(args));
    if (chromeNamedSandboxFailure(error) || ++closedTargetRetries >= 2) sandboxRefused = true;
    if (!warned) {
      warned = true;
      console.warn(
        "[hyperframes] Chrome could not start with its sandbox on this host (user namespaces are likely restricted), so it runs without it. Set HYPERFRAMES_CHROME_SANDBOX=0 to skip the sandboxed attempt.",
      );
    }
    return browser;
  }
}
