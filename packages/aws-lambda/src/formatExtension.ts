/**
 * Map a distributed `format` to the file extension the assembled output
 * should carry on disk + in S3. Shared by `src/handler.ts` (chunk +
 * assemble output paths) and `src/sdk/renderToLambda.ts` (final
 * output key construction) so the two sides agree on what an mp4
 * looks like vs a png-sequence.
 */

import type { DistributedFormat } from "@hyperframes/producer/distributed";

export type { DistributedFormat } from "@hyperframes/producer/distributed";

// Closed-enum lookup table. TS enforces exhaustiveness via the
// `Record<DistributedFormat, string>` annotation — adding a format to
// `DistributedFormat` without adding the matching key here fails to
// typecheck, which is the same exhaustiveness guarantee a switch +
// `_exhaustive: never` arm provides but at lower complexity.
const FORMAT_EXTENSIONS: Record<DistributedFormat, string> = {
  mp4: ".mp4",
  mov: ".mov",
  webm: ".webm",
  "png-sequence": "",
};

export function formatExtension(format: DistributedFormat): string {
  return FORMAT_EXTENSIONS[format];
}
