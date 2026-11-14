import {
  chromeSandboxArgs,
  chromeSandboxEnabled,
  type ChromeSandboxHost,
} from "@hyperframes/engine";

let warnedSandboxOff = false;

export function _resetCaptureSandboxWarningForTests(): void {
  warnedSandboxOff = false;
}

/**
 * Capture loads arbitrary websites, so Chrome keeps its sandbox unless the host can't give it one
 * (root, serverless, a container, or blocked user namespaces). Say so once when the host check
 * turns it off; HYPERFRAMES_CHROME_SANDBOX=0 is an explicit choice and stays quiet.
 */
export function captureSandboxEnabled(host?: ChromeSandboxHost): boolean {
  const enabled = chromeSandboxEnabled(host);
  const env = host?.env ?? process.env;
  if (!enabled && env.HYPERFRAMES_CHROME_SANDBOX !== "0" && !warnedSandboxOff) {
    warnedSandboxOff = true;
    console.warn(
      "[hyperframes] Chrome's sandbox is off for website capture on this host (running as root, in a container or serverless runtime, or with user namespaces restricted). Capture only sites you trust here, or set HYPERFRAMES_CHROME_SANDBOX=1 to require the sandbox.",
    );
  }
  return enabled;
}

export function captureBrowserArgs(
  disableWebgl: boolean,
  viewportWidth: number,
  viewportHeight: number,
  sandbox: boolean = captureSandboxEnabled(),
): string[] {
  return [
    ...chromeSandboxArgs(sandbox),
    "--disable-dev-shm-usage",
    ...(disableWebgl
      ? ["--disable-gpu"]
      : ["--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"]),
    "--disable-blink-features=AutomationControlled",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    `--window-size=${viewportWidth},${viewportHeight}`,
  ];
}
