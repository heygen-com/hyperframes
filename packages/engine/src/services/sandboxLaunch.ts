import type { LaunchOptions } from "puppeteer-core";

const MACH_SERVICE_DENIED = /bootstrap_check_in\b[^\n]*Permission denied/;
const SINGLE_PROCESS = "--single-process";
const CPU_COMPOSITING = "--disable-gpu-compositing";

export function machServiceDenied(errorMessage: string): boolean {
  return MACH_SERVICE_DENIED.test(errorMessage);
}

export function pipeLaunchClosedOnMac(error: unknown, platform = process.platform): boolean {
  return platform === "darwin" && error instanceof Error && error.name === "TargetCloseError";
}

/** Codex runs agent commands in a macOS seatbelt, which names itself in the environment. */
export function inAgentSandbox(env = process.env, platform = process.platform): boolean {
  return platform === "darwin" && env.CODEX_SANDBOX === "seatbelt";
}

/** The one launch a seatbelt allows: no child process registers a mach port, nothing listens, no GPU composites. */
export function oneProcessOverPipe(options: LaunchOptions): LaunchOptions {
  const args = options.args ?? [];
  const missing = [SINGLE_PROCESS, CPU_COMPOSITING].filter((flag) => !args.includes(flag));
  return { ...options, pipe: true, args: [...args, ...missing] };
}

export function isOneProcessOverPipe(options: LaunchOptions): boolean {
  return options.pipe === true && (options.args ?? []).includes(SINGLE_PROCESS);
}

/** A process sandbox (an agent's macOS seatbelt) refused Chrome its mach service, so no browser starts here. */
export function sandboxDeniedRemediation(errorMessage: string): string | undefined {
  if (!machServiceDenied(errorMessage)) return undefined;
  return [
    "The browser can't start inside this sandbox: macOS refused Chrome's mach service (bootstrap_check_in: Permission denied).",
    "Rerun this command with escalation, outside the sandbox.",
  ].join("\n");
}
