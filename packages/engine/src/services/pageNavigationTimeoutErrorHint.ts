/**
 * Augment Puppeteer `page.goto` navigation-timeout errors with actionable
 * guidance that names the HyperFrames-specific knobs. Puppeteer's stock error
 * text ("Navigation timeout of 60000 ms exceeded") doesn't tell the user
 * which env var / CLI flag raises this timeout in HyperFrames, or which
 * browser-binary override lets them route around a slow pinned build.
 *
 * Sibling of `augmentProtocolTimeoutError` (surfaces
 * `PRODUCER_PUPPETEER_PROTOCOL_TIMEOUT_MS` / `--protocol-timeout` on the
 * `Runtime.callFunctionOn timed out` class), and mirrors the surfacing
 * pattern from #2443 (which surfaces `HYPERFRAMES_BROWSER_PATH` on
 * download-time failures). This helper covers the runtime `page.goto` layer
 * instead:
 *
 *   1. Raise-the-timeout: `PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS` env,
 *      `--browser-timeout` CLI flag (SECONDS, not ms).
 *   2. Escape-hatch browser binary: `HYPERFRAMES_BROWSER_PATH` env, points
 *      at a system Chrome / chrome-headless-shell path.
 *   3. Field-signal shape: darwin/arm64 CSS 3D + audio compound
 *      (ts=1784146416) that succeeded under Docker — gated on all three
 *      inputs being explicitly true.
 *
 * Design is conservative — non-matching errors flow through unchanged (same
 * instance). Non-Error inputs are coerced with `new Error(String(err))` so
 * callers always receive a well-typed `Error`. Original error preserved via
 * `err.cause` for downstream logging / observability.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Compound-hint fallback (documented per stack-review guardrails)
 * ─────────────────────────────────────────────────────────────────────────
 * The field signal cites the darwin/arm64 + CSS-3D + audio-track compound as
 * the shape where the Docker fallback rendered identically. The Docker hint
 * therefore fires ONLY when all three are true. When any one is unknown
 * (`undefined`) the helper falls back to the generic env + browser-path
 * hints — the Docker fallback is not universally applicable and surfacing
 * it outside the known-good compound risks recommending Docker on shapes it
 * hasn't been verified for.
 *
 * At the current wire-up in `renderOrchestrator.executeRenderJob`'s
 * top-level catch, `hasAudio` is in scope (computed in the `audio_process`
 * stage) but a CSS-3D compile-time signal isn't threaded through the
 * pipeline: grep `packages/producer/src/services/` and
 * `packages/engine/src/services/` — no compile-time `hasCss3D` boolean
 * exists; `parseTransformMatrix` in `alphaBlit.ts` detects 3D matrices at
 * engine-init runtime, AFTER `page.goto` has already succeeded. So the
 * current wire-up passes `hasCss3D: undefined`, and the Docker hint does
 * NOT fire in production today. The helper accepts both flags so a future
 * PR that lands a compile-time `hasCss3D` scan (e.g. an htmlCompiler.ts
 * pass over `transform-style: preserve-3d`, `perspective:`, `rotateX(`,
 * `rotateY(`, `matrix3d(`) can enable the full compound hint without
 * touching this helper's signature.
 */

const NAVIGATION_TIMEOUT_MATCHER = /Navigation timeout|net::ERR_TIMED_OUT/i;

export interface NavigationTimeoutHintContext {
  /** `process.platform` at the catch site. Defaults to the current process. */
  platform?: NodeJS.Platform;
  /** `process.arch` at the catch site. Defaults to the current process. */
  arch?: NodeJS.Architecture | string;
  /**
   * Whether the composition uses a CSS 3D rendering context. Callers pass
   * `undefined` when this signal isn't threaded through — the Docker hint
   * then does not fire (see fallback docs above).
   */
  hasCss3D?: boolean;
  /**
   * Whether the composition has an audio track. Callers pass `undefined`
   * when the signal isn't threaded through — the Docker hint then does not
   * fire.
   */
  hasAudio?: boolean;
}

export function augmentPageNavigationTimeoutError(
  err: unknown,
  effectiveTimeoutMs: number,
  context: NavigationTimeoutHintContext = {},
): Error {
  if (!(err instanceof Error)) return new Error(String(err));
  if (!NAVIGATION_TIMEOUT_MATCHER.test(err.message)) return err;

  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;

  const dockerHint = shouldSurfaceDockerHint({
    platform,
    arch,
    hasCss3D: context.hasCss3D,
    hasAudio: context.hasAudio,
  })
    ? buildDockerHintBlock()
    : "";

  const augmented = new Error(
    `${err.message}\n\n` +
      `HyperFrames effective page.goto navigation timeout: ${effectiveTimeoutMs} ms.\n\n` +
      `To raise the timeout:\n` +
      `  Env: PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS=<higher-ms>  (milliseconds)\n` +
      `  CLI: --browser-timeout <seconds>                     (seconds)\n\n` +
      `To use a different browser binary (e.g. system Chrome instead of the pinned chrome-headless-shell):\n` +
      `  Env: HYPERFRAMES_BROWSER_PATH=<path-to-Chrome-or-chrome-headless-shell>\n` +
      dockerHint,
  );
  (augmented as Error & { cause?: unknown }).cause = err;
  return augmented;
}

/**
 * Predicate variant: exposed for callers that only need to classify an
 * error (e.g. observability, tests) without materialising an augmented
 * Error. Uses the same matcher as the augmentation path so the two never
 * drift.
 */
export function isPageNavigationTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return NAVIGATION_TIMEOUT_MATCHER.test(message);
}

interface DockerHintGate {
  platform: NodeJS.Platform | string;
  arch: NodeJS.Architecture | string;
  hasCss3D?: boolean;
  hasAudio?: boolean;
}

/**
 * The Docker fallback hint fires only on the darwin/arm64 + CSS-3D + audio
 * compound the field signal exercised. Requiring all three to be
 * explicitly true (not just truthy — `undefined` is not enough) prevents
 * the hint from firing on shapes where the Docker fallback hasn't been
 * verified. Other platforms have different failure modes and different
 * remediation surfaces (Windows GPU compound → PR #2505, Linux headless
 * quirks → separate).
 */
function shouldSurfaceDockerHint(gate: DockerHintGate): boolean {
  return (
    gate.platform === "darwin" &&
    gate.arch === "arm64" &&
    gate.hasCss3D === true &&
    gate.hasAudio === true
  );
}

function buildDockerHintBlock(): string {
  return (
    `\nField signal ts=1784146416 (darwin/arm64 host mode, CLI 0.7.58): the compound of\n` +
    `a CSS 3D rendering context + audio track on macOS arm64 has been reported to hit\n` +
    `Navigation timeout twice at page.goto while the same composition renders\n` +
    `identically under Docker. Consider:\n` +
    `  hyperframes render ... --docker\n`
  );
}
