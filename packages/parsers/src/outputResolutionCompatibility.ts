/**
 * Shared "is this `outputResolution` preset compatible with the composition?"
 * check.
 *
 * The `--resolution` render flag (a `CanvasResolution` preset) is chosen
 * independently of the composition it renders, so a portrait composition
 * (1080×1920) rendered with `--resolution landscape` (1920×1080) is a common
 * mistake — especially from AI agents that pick a preset by habit rather than
 * by inspecting the composition. Historically this surfaced as a cryptic
 * `Error` thrown deep inside the render compiler (`resolveDeviceScaleFactor`
 * in `@hyperframes/producer`), after the browser and ffmpeg had already spun
 * up, with a message that named the mismatch but not the fix.
 *
 * This module gives every consumer (the render pre-flight in the CLI, the
 * producer's `resolveDeviceScaleFactor`, and any future lint rule) a single,
 * dependency-free definition of "is this preset usable for this composition"
 * — including a suggested preset when there's an unambiguously-correct swap —
 * so the same check can run *before* a render is attempted (loud, actionable,
 * cheap) and again as defense-in-depth inside the pipeline.
 *
 * It lives in `@hyperframes/parsers` (rather than `@hyperframes/core`) because
 * both `core`/`producer` and `lint` may need it, and `lint` cannot depend on
 * `core`. The geometry it needs (`CANVAS_DIMENSIONS`) already lives here.
 */

import { CANVAS_DIMENSIONS, VALID_CANVAS_RESOLUTIONS, type CanvasResolution } from "./types.js";

export type OutputResolutionIssueKind =
  | "hdr-incompatible"
  | "alpha-incompatible"
  | "aspect-mismatch"
  | "downsampling"
  | "non-integer-scale";

export interface OutputResolutionCompatibility {
  ok: boolean;
  /** Present when `ok` is false. */
  kind?: OutputResolutionIssueKind;
  /** Human-readable, actionable message suitable for direct display. */
  message?: string;
  /**
   * A preset whose orientation/aspect ratio matches the composition, when one
   * exists and is an unambiguous swap for the user's intent. Present only for
   * `aspect-mismatch`. Consumers may surface this as a suggestion ("did you
   * mean `--resolution portrait`?"); it is intentionally *not* auto-applied —
   * silently swapping a user-supplied flag changes their stated intent.
   */
  suggestedResolution?: CanvasResolution;
}

const OK: OutputResolutionCompatibility = { ok: true };

/**
 * Find the preset that shares the composition's aspect ratio and resolution
 * tier (HD vs 4K) as the user's chosen preset. E.g. a portrait composition
 * with `--resolution landscape-4k` suggests `portrait-4k`, not `portrait`,
 * preserving the user's intent to render at 4K while fixing the orientation.
 *
 * Returns `undefined` when no preset matches the composition's aspect ratio
 * (e.g. a custom, non-preset composition aspect ratio) — in that case there
 * is no unambiguous swap to suggest.
 */
function suggestMatchingPreset(
  compositionWidth: number,
  compositionHeight: number,
  chosen: CanvasResolution,
): CanvasResolution | undefined {
  const aspectMatches: CanvasResolution[] = VALID_CANVAS_RESOLUTIONS.filter((preset) => {
    const { width, height } = CANVAS_DIMENSIONS[preset];
    // Integer-safe aspect compare (cross-multiplication), matching the
    // producer's mismatch check exactly.
    return width * compositionHeight === height * compositionWidth;
  });
  if (aspectMatches.length === 0) return undefined;

  // Prefer the aspect-matching preset in the same resolution tier as the chosen
  // one so we don't silently downgrade 4K → HD (or vice versa). Tier is keyed
  // off the `-4k` suffix rather than long-side pixels: a 4K *square* (2160×2160)
  // has a shorter long side than 4K landscape (3840), so a pixel-based compare
  // would fail to recognise `square-4k` as the 4K peer and downgrade to `square`.
  const chosenIs4k = chosen.endsWith("-4k");
  const sameTier = aspectMatches.find((preset) => preset.endsWith("-4k") === chosenIs4k);
  return sameTier ?? aspectMatches[0];
}

function describeOrientation(width: number, height: number): string {
  if (width > height) return "landscape";
  if (width < height) return "portrait";
  return "square";
}

/** Build the aspect-ratio-mismatch result, including a preset suggestion. */
function buildAspectMismatch(
  compositionWidth: number,
  compositionHeight: number,
  outputResolution: CanvasResolution,
  target: { width: number; height: number },
): OutputResolutionCompatibility {
  const suggestedResolution = suggestMatchingPreset(
    compositionWidth,
    compositionHeight,
    outputResolution,
  );
  const suggestion = suggestedResolution
    ? ` The composition is ${describeOrientation(compositionWidth, compositionHeight)} — ` +
      `use --resolution ${suggestedResolution} instead.`
    : ` Pick a preset whose orientation matches, or omit --resolution to render at the composition's native dimensions.`;
  return {
    ok: false,
    kind: "aspect-mismatch",
    suggestedResolution,
    message:
      `outputResolution ${outputResolution} (${target.width}×${target.height}) ` +
      `does not match the aspect ratio of the composition ` +
      `(${compositionWidth}×${compositionHeight}).` +
      suggestion,
  };
}

/**
 * Check whether rendering a composition of the given dimensions with the given
 * `outputResolution` preset (and alpha/HDR modes) is supported.
 *
 * Pure and dependency-free — the single source of truth for the constraints
 * `resolveDeviceScaleFactor` enforces, so the CLI can run the exact same check
 * as a pre-flight before any browser/ffmpeg work.
 *
 * @param outputResolution The chosen preset, or `undefined` when the render
 *   uses the composition's native dimensions (always compatible).
 */
export function checkOutputResolutionCompatibility(input: {
  compositionWidth: number;
  compositionHeight: number;
  outputResolution: CanvasResolution | undefined;
  alphaRequested?: boolean;
  hdrRequested?: boolean;
}): OutputResolutionCompatibility {
  const { compositionWidth, compositionHeight, outputResolution } = input;
  if (!outputResolution) return OK;

  if (input.hdrRequested) {
    return {
      ok: false,
      kind: "hdr-incompatible",
      message:
        `outputResolution cannot be combined with hdrMode='force-hdr'. ` +
        `HDR rendering composites at composition dimensions and does not yet ` +
        `support supersampling. Pick one or render in two passes.`,
    };
  }

  if (input.alphaRequested) {
    return {
      ok: false,
      kind: "alpha-incompatible",
      message:
        `outputResolution cannot be combined with alpha output (--format webm|mov|png-sequence). ` +
        `The alpha screenshot path does not yet apply deviceScaleFactor and would silently ` +
        `produce composition-resolution frames. Render alpha at composition resolution and ` +
        `upscale separately, or use --format mp4.`,
    };
  }

  const target = CANVAS_DIMENSIONS[outputResolution];
  // Aspect-ratio compare via cross-multiplication so the equality is integer-
  // safe. Float division (`target.width / compositionWidth`) loses precision
  // for non-power-of-2 ratios (e.g. cinema 4K 4096×2160 = 1.8963…) and a
  // future preset could trip a false-mismatch on otherwise valid input.
  if (target.width * compositionHeight !== target.height * compositionWidth) {
    return buildAspectMismatch(compositionWidth, compositionHeight, outputResolution, target);
  }

  // Aspect ratios match → widthRatio === heightRatio. Compute once.
  const widthRatio = target.width / compositionWidth;
  if (widthRatio < 1) {
    return {
      ok: false,
      kind: "downsampling",
      message:
        `outputResolution ${outputResolution} (${target.width}×${target.height}) ` +
        `is smaller than the composition (${compositionWidth}×${compositionHeight}). ` +
        `Downsampling via --resolution is not supported.`,
    };
  }

  if (!Number.isInteger(widthRatio)) {
    return {
      ok: false,
      kind: "non-integer-scale",
      message:
        `outputResolution ${outputResolution} requires a non-integer ` +
        `device scale factor (${widthRatio}×) to upsample from ` +
        `${compositionWidth}×${compositionHeight}. ` +
        `Pick a preset that's an integer multiple, or rescale the composition.`,
    };
  }

  return OK;
}
