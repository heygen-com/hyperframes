/**
 * Auto-detect a HyperFrames composition's aspect ratio from the entry HTML's
 * root `<div data-composition-id ...>` `data-width` / `data-height` attributes.
 *
 * The cloud-render CLI uses this when the user hasn't passed `--aspect-ratio`
 * explicitly AND the project source is a local directory (asset-id and url
 * paths can't be inspected client-side). The result is passed through to the
 * `/v3/hyperframes/renders` request body, so the rendered output preserves
 * the composition's intended ratio without the user having to remember the
 * flag.
 *
 * Detection only matches the three values the API currently supports:
 * `16:9`, `9:16`, `1:1`. Anything else (e.g. 4:5, 5:4, or an unusual custom
 * ratio) returns a `"no-match"` result with the computed ratio for the
 * caller to surface to the user. `auto`-style fallbacks (server-side, etc.)
 * are out of scope here.
 *
 * Parsing approach: a narrow regex over the HTML. The root composition div is
 * a well-defined pattern (`data-composition-id` always appears on it) and we
 * only need two attributes off the same tag. Pulling in `jsdom` or a full DOM
 * parser is heavier than the problem warrants.
 */

import { readFileSync } from "node:fs";

export type SupportedAspectRatio = "16:9" | "9:16" | "1:1";

export type AspectRatioDetection =
  | {
      kind: "matched";
      aspectRatio: SupportedAspectRatio;
      width: number;
      height: number;
    }
  | { kind: "no-root-div" }
  | { kind: "no-dims" }
  | { kind: "invalid-dims"; width: number; height: number }
  | { kind: "no-match"; width: number; height: number; ratio: number }
  | { kind: "read-error"; error: string };

// Absolute tolerance on the computed ratio. Wide enough to absorb
// floating-point sloppiness on canonical ratios (e.g. 1920×1080 = 1.7778);
// tight enough to keep 4:5 (0.8) and 5:4 (1.25) outside the bands so they
// fall through to the "no-match" warning instead of getting silently
// mis-classified as 1:1 or 16:9.
const RATIO_TOLERANCE = 0.05;

const SUPPORTED_RATIOS: Array<{ value: SupportedAspectRatio; ratio: number }> = [
  { value: "16:9", ratio: 16 / 9 },
  { value: "9:16", ratio: 9 / 16 },
  { value: "1:1", ratio: 1 },
];

// First `<div ... data-composition-id="..." ...>` opening tag in the file.
// Quote style is intentionally permissive — single, double, or unquoted all
// match. Case-insensitive to handle `<DIV>` or `Data-Composition-Id` mid-edit.
const ROOT_COMPOSITION_DIV_RE =
  /<div\b[^>]*?\bdata-composition-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>/i;

// `data-width` / `data-height` attribute extractors. Accept integer or float
// values, quoted or unquoted. The `\d` class restricts to ASCII digits — no
// locale comma surprises.
const DATA_WIDTH_RE =
  /\bdata-width\s*=\s*(?:"(\d+(?:\.\d+)?)"|'(\d+(?:\.\d+)?)'|(\d+(?:\.\d+)?))(?=\s|>|\/)/i;
const DATA_HEIGHT_RE =
  /\bdata-height\s*=\s*(?:"(\d+(?:\.\d+)?)"|'(\d+(?:\.\d+)?)'|(\d+(?:\.\d+)?))(?=\s|>|\/)/i;

function extractAttributeNumber(tag: string, re: RegExp): number | null {
  const match = tag.match(re);
  if (!match) return null;
  // First capture group that matched (quoted-double | quoted-single | unquoted).
  const raw = match[1] ?? match[2] ?? match[3];
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse the HTML at `entryHtmlPath` and detect which supported aspect ratio
 * the composition's root div is authored at.
 *
 * Pure function except for `readFileSync` — no logging, no `process.exit`.
 * The caller decides how to surface each result kind to the user.
 */
export function detectAspectRatioFromHtml(entryHtmlPath: string): AspectRatioDetection {
  let html: string;
  try {
    html = readFileSync(entryHtmlPath, "utf-8");
  } catch (err) {
    return { kind: "read-error", error: err instanceof Error ? err.message : String(err) };
  }
  return detectAspectRatioFromHtmlString(html);
}

/**
 * Same as `detectAspectRatioFromHtml`, but takes the HTML as a string instead
 * of a file path. Exposed for tests + composition-string callers.
 */
export function detectAspectRatioFromHtmlString(html: string): AspectRatioDetection {
  const tagMatch = html.match(ROOT_COMPOSITION_DIV_RE);
  if (!tagMatch) return { kind: "no-root-div" };

  const openTag = tagMatch[0];
  const width = extractAttributeNumber(openTag, DATA_WIDTH_RE);
  const height = extractAttributeNumber(openTag, DATA_HEIGHT_RE);

  if (width === null || height === null) return { kind: "no-dims" };
  if (width <= 0 || height <= 0) return { kind: "invalid-dims", width, height };

  const ratio = width / height;
  for (const candidate of SUPPORTED_RATIOS) {
    if (Math.abs(ratio - candidate.ratio) <= RATIO_TOLERANCE) {
      return { kind: "matched", aspectRatio: candidate.value, width, height };
    }
  }
  return { kind: "no-match", width, height, ratio };
}

/**
 * The tolerance used when matching the computed ratio to a supported value.
 * Exposed for tests + caller introspection (e.g. warning messages that want
 * to mention the bounds).
 */
export const ASPECT_RATIO_MATCH_TOLERANCE = RATIO_TOLERANCE;
