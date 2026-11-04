/**
 * Shared dimension-mismatch warning for `hyperframes lambda render` and
 * `lambda render-batch`. The runtime lays the page out at the composition's
 * `data-width`/`data-height`, so passing `--width 3840 --height 2160`
 * against a 1920×1080 composition silently produces a 1080p output. Warn
 * early and point at `--output-resolution` (the supersampling path).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { outputResolutionForSize, type CanvasResolution } from "@hyperframes/core";
import { findCompositionDimensions } from "../../utils/compositionViewport.js";

export interface DimensionMismatchArgs {
  projectDir: string;
  cliWidth: number;
  cliHeight: number;
  outputResolution: CanvasResolution | undefined;
}

export function resolveOutputResolutionFromSize(
  args: DimensionMismatchArgs,
): CanvasResolution | undefined {
  if (args.outputResolution) return args.outputResolution;
  let html: string;
  try {
    html = readFileSync(join(args.projectDir, "index.html"), "utf-8");
  } catch {
    return undefined;
  }
  const composition = findCompositionDimensions(html);
  if (!composition) return undefined;
  const size = outputResolutionForSize({
    compositionWidth: composition.width,
    compositionHeight: composition.height,
    width: args.cliWidth,
    height: args.cliHeight,
  });
  if (!size.ok) throw new Error(`--width/--height: ${size.message}`);
  return size.outputResolution;
}
