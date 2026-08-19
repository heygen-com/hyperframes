// fallow-ignore-file code-duplication
/**
 * Detection + remediation for macOS-below-13 chrome-headless-shell dyld
 * launch crashes.
 *
 * Field feedback (#hyperframes-cli-feedback ts=1784227832, darwin/x64,
 * macOS 12, HyperFrames CLI 0.7.60) hit
 * `dyld: Symbol not found: _kVTCompressionPropertyKey_ReferenceBufferCount`
 * from `VideoToolbox` when launching the pinned
 * `chrome-headless-shell mac-152.0.7928.2`. The symbol was added in
 * macOS 13; older hosts cannot resolve it, so the binary aborts at load
 * before any browser process starts.
 *
 * The reporter recovered by installing an older shell (v150) via
 * `@puppeteer/browsers install chrome-headless-shell@150` and pointing
 * `PRODUCER_HEADLESS_SHELL_PATH` at it. Their check/snapshot commands
 * accepted that older cached shell (they don't force the pinned build),
 * but the render command required v152 via `preferManagedChrome: true`
 * and therefore could not fall back on its own. The generic
 * "Try --docker for containerized rendering" hint didn't name any of
 * the browser-path env vars, so the workaround is undiscoverable
 * unaided.
 *
 * Same discoverability class as #2443 (download failure), #2078 (arm64
 * SIGTRAP at launch), and #2481 (Windows STATUS_STACK_BUFFER_OVERRUN):
 * detect the launch-time crash signal, surface `HYPERFRAMES_BROWSER_PATH`
 * (and its `PRODUCER_HEADLESS_SHELL_PATH` alias — see #2471) with a
 * concrete macOS example.
 *
 * The match is gated on the Puppeteer launch-failure wrapper text AND
 * the dyld symbol-not-found signal AND a macOS-13-only symbol, so
 * unrelated darwin launch failures do not mis-fire this hint. The
 * symbol-name signal is macOS-version-specific by construction:
 * `_kVTCompressionPropertyKey_ReferenceBufferCount` only exists on
 * macOS 13+, so if a user's dyld cannot find it, their host is <13.
 * That means we do not need a separate `os.release()` gate — the
 * signal itself is the version discriminator.
 */

const DYLD_SYMBOL_NOT_FOUND = /Symbol not found:/i;
const MACOS_13_ONLY_SYMBOL = /_kVTCompressionPropertyKey_ReferenceBufferCount/;
const VIDEO_TOOLBOX = /VideoToolbox/;

export function isMacosOldChromeCrashError(errorMessage: string): boolean {
  if (!/Failed to launch the browser process/i.test(errorMessage)) return false;
  if (!DYLD_SYMBOL_NOT_FOUND.test(errorMessage)) return false;
  // Both signals must be present. The specific macOS-13-only symbol is what
  // makes this hint safe to fire (any other Symbol-not-found on darwin
  // needs different remediation — a shared-lib install, an Xcode SDK
  // mismatch, etc. — none of which are fixed by HYPERFRAMES_BROWSER_PATH).
  // We also require VideoToolbox to catch the case where a future pinned
  // build hits a different `_kVT…` symbol from the same framework.
  return MACOS_13_ONLY_SYMBOL.test(errorMessage) || VIDEO_TOOLBOX.test(errorMessage);
}

export function macosOldChromeCrashRemediation(errorMessage: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  if (!isMacosOldChromeCrashError(errorMessage)) return undefined;
  return [
    "chrome-headless-shell crashed at launch (macOS dyld: Symbol not found in VideoToolbox).",
    "The pinned Chromium build requires macOS 13+; on macOS 12 or older, install an older",
    "chrome-headless-shell and point hyperframes at it:",
    "",
    "  npx @puppeteer/browsers install chrome-headless-shell@150",
    '  export HYPERFRAMES_BROWSER_PATH="$HOME/.cache/puppeteer/chrome-headless-shell/mac-150.0.7422.0/chrome-headless-shell-mac-x64/chrome-headless-shell"',
    "",
    "(PRODUCER_HEADLESS_SHELL_PATH works as an alias for the same override.)",
    "Any working chrome-headless-shell build resolves this — the exact version above is one",
    "known-good macOS-12 combination. Alternatively, point HYPERFRAMES_BROWSER_PATH at your",
    'installed Google Chrome ("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")',
    "to fall back to the screenshot capture path.",
  ].join("\n");
}
