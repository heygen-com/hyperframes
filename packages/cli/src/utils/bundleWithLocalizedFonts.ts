import { normalizeErrorMessage } from "./errorMessage.js";
import { c } from "../ui/colors.js";

/**
 * Bundle a project to a single HTML string AND localize its fonts — fetch and
 * embed `@font-face` rules for every requested family (including families
 * declared only via a remote `<link>`, e.g. Google Fonts) as data URIs.
 *
 * Why the audit/snapshot paths need this: core's `bundleToSingleHtml` inlines
 * only LOCAL stylesheets and leaves remote font `<link>`s as-is, so a snapshot
 * depends on loading the remote font at capture time. The render pipeline
 * instead localizes fonts in its compile stage, which is why a render embeds
 * (say) League Gothic correctly while a snapshot of the same composition can
 * fall back to an un-styled system sans when the remote font loses the race
 * against the capture. Running the SAME localization the render path uses makes
 * snapshot/check captures font-faithful and deterministic — no network race.
 */
export async function bundleWithLocalizedFonts(
  projectDir: string,
  // Injectable for tests. Production callers omit it and get the producer
  // font-localization pass (see localizeWithProducer).
  localizeFonts: (html: string) => Promise<string> = localizeWithProducer,
): Promise<string> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const html = await bundleToSingleHtml(projectDir);
  return localizeFonts(html);
}

type FontInjector = (html: string) => Promise<string>;

/**
 * Load the render pipeline's `injectDeterministicFontFaces`, resolving
 * `@hyperframes/producer` at RUNTIME only. The specifier is kept out of the
 * bundler's/test-runner's static module graph (`@vite-ignore` + a variable
 * specifier) on purpose: the CLI test job builds with `--filter
 * '!@hyperframes/producer'`, so a static `import("@hyperframes/producer")`
 * would fail Vitest's transform-time resolution. At runtime — the built CLI or
 * an installed package — producer is a real dependency and resolves via
 * node_modules.
 *
 * Returns `null` (not a throw) when the module simply isn't available in this
 * environment, so the caller can treat "producer absent" — a benign, expected
 * condition — differently from "the injector itself failed".
 */
async function loadFontInjector(): Promise<FontInjector | null> {
  try {
    const producerSpecifier = "@hyperframes/producer";
    const mod = (await import(/* @vite-ignore */ producerSpecifier)) as {
      injectDeterministicFontFaces?: FontInjector;
    };
    return mod.injectDeterministicFontFaces ?? null;
  } catch {
    return null;
  }
}

const warnedFontLocalizationFailures = new Set<string>();

/** Reset the dedup latch — tests only. */
export function __resetFontLocalizationWarningsForTests(): void {
  warnedFontLocalizationFailures.clear();
}

/**
 * Localize fonts via the producer injector, distinguishing two failure modes:
 *
 *  - **Module unavailable** (`loadInjector` yields `null`): benign — producer
 *    isn't in this environment. Return the HTML unchanged, silently; fonts
 *    declared via a remote `<link>` still load at capture time as before.
 *  - **Injector threw** (a fetch layer failed, a family errored past the
 *    injector's own per-family handling): unexpected — surface it ONCE per
 *    distinct message (snapshot/check re-bundle per grid point, so an
 *    un-deduped warning would spam), then fail open to the plain bundle.
 *
 * Per-family resolution failures inside a successful pass are already reported
 * by the injector itself (producer's `warnUnresolvedFonts`); this layer only
 * owns the module-vs-execution distinction and the dedup.
 */
export async function localizeWithProducer(
  html: string,
  loadInjector: () => Promise<FontInjector | null> = loadFontInjector,
  warn: (message: string) => void = (m) => console.warn(`   ${c.warn("⚠")} ${m}`),
): Promise<string> {
  const inject = await loadInjector();
  if (!inject) return html;
  try {
    return await inject(html);
  } catch (err) {
    const message = `Font localization failed; capturing with remote/fallback fonts instead: ${normalizeErrorMessage(err)}`;
    if (!warnedFontLocalizationFailures.has(message)) {
      warnedFontLocalizationFailures.add(message);
      warn(message);
    }
    return html;
  }
}
