/**
 * Shared dimension-mismatch warning for `hyperframes lambda render` and
 * `lambda render-batch`. The runtime lays the page out at the composition's
 * `data-width`/`data-height`, so passing `--width 3840 --height 2160`
 * against a 1920×1080 composition silently produces a 1080p output. Warn
 * early and point at `--output-resolution` (the supersampling path).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CanvasResolution } from "@hyperframes/core";
import { c } from "../../ui/colors.js";
import { findCompositionDimensions } from "../../utils/compositionViewport.js";

export interface DimensionMismatchArgs {
  projectDir: string;
  cliWidth: number;
  cliHeight: number;
  outputResolution: CanvasResolution | undefined;
  /** Suppress the warning when stdout is reserved for machine output (--json). */
  quiet: boolean;
}

// fallow-ignore-next-line complexity
export function warnOnDimensionMismatch(args: DimensionMismatchArgs): void {
  if (args.quiet) return;
  if (args.outputResolution) return;
  let html: string;
  try {
    html = readFileSync(join(args.projectDir, "index.html"), "utf-8");
  } catch {
    return;
  }
  const composition = findCompositionDimensions(html);
  if (!composition) return;
  if (composition.width === args.cliWidth && composition.height === args.cliHeight) return;
  console.warn(
    c.warn(
      `--width/--height (${args.cliWidth}×${args.cliHeight}) disagrees with the composition's ` +
        `data-width/data-height (${composition.width}×${composition.height}). The runtime lays out ` +
        `the page at the composition's authored dimensions, so your output will be ` +
        `${composition.width}×${composition.height}, not ${args.cliWidth}×${args.cliHeight}.\n` +
        `  To supersample to a higher resolution, pass --output-resolution (e.g. \`--output-resolution=4k\`).\n` +
        `  To truly change layout dimensions, edit the composition's data-width/data-height in index.html.`,
    ),
  );
}
