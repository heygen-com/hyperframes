/**
 * Detection + remediation for Windows chrome-headless-shell launch crashes.
 *
 * Field feedback (#hyperframes-cli-feedback ts=1784116246, win32/x64,
 * HyperFrames CLI 0.7.58) hit the exact error
 * `Failed to launch the browser process ... Code: 3221225595` with no stderr.
 * Exit code 3221225595 == 0xC0000409 == STATUS_STACK_BUFFER_OVERRUN — a Windows
 * stack-corruption fatal reported against the pinned chrome-headless-shell
 * binary on some Win10/Win11 hosts (typically pre-24H2 or particular AV/EDR
 * combinations). The reporter recovered by pointing `HYPERFRAMES_BROWSER_PATH`
 * at their system Chrome; the render then used the screenshot fallback and
 * produced a complete MP4.
 *
 * The generic "Try --docker" hint the CLI already emits doesn't name that env
 * var, so the workaround is undiscoverable unaided. Sibling failure mode to
 * the download-time hint added in #2443 and the closed-with-invite #2078
 * (SIGTRAP at launch on macOS arm64); same `HYPERFRAMES_BROWSER_PATH`
 * remediation, different trigger + platform.
 *
 * The match is gated on both the Puppeteer launch-failure wrapper text AND the
 * specific crash-code signal (decimal, hex, or symbol name) so unrelated
 * Windows launch failures — which need different remediation — don't
 * mis-fire this hint.
 */

const STATUS_STACK_BUFFER_OVERRUN_DEC = "3221225595";
const STATUS_STACK_BUFFER_OVERRUN_HEX = /0x[cC]0000409/;
const STATUS_STACK_BUFFER_OVERRUN_NAME = /STATUS_STACK_BUFFER_OVERRUN/i;

export function isWindowsChromeCrashError(errorMessage: string): boolean {
  if (!/Failed to launch the browser process/i.test(errorMessage)) return false;
  return (
    errorMessage.includes(STATUS_STACK_BUFFER_OVERRUN_DEC) ||
    STATUS_STACK_BUFFER_OVERRUN_HEX.test(errorMessage) ||
    STATUS_STACK_BUFFER_OVERRUN_NAME.test(errorMessage)
  );
}

export function windowsChromeCrashRemediation(errorMessage: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (!isWindowsChromeCrashError(errorMessage)) return undefined;
  return [
    "chrome-headless-shell crashed at launch (Windows STATUS_STACK_BUFFER_OVERRUN, exit 0xC0000409 / 3221225595).",
    "The pinned Chromium build is not stable on this Windows host; point hyperframes at your installed Chrome instead:",
    "",
    '  set HYPERFRAMES_BROWSER_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"',
    "",
    "Then re-run your command. Any Chrome build works for the screenshot capture path; install a real chrome-headless-shell later if you need the perf-optimized BeginFrame path.",
  ].join("\n");
}
