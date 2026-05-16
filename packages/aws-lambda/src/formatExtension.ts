/**
 * Map a distributed `format` to the file extension the assembled output
 * should carry on disk + in S3. Shared by `src/handler.ts` (chunk +
 * assemble output paths) and `src/sdk/renderToLambda.ts` (final
 * output key construction) so the two sides agree on what an mp4
 * looks like vs a png-sequence.
 */

export type DistributedFormat = "mp4" | "mov" | "png-sequence";

export function formatExtension(format: DistributedFormat): string {
  switch (format) {
    case "mp4":
      return ".mp4";
    case "mov":
      return ".mov";
    case "png-sequence":
      return "";
    default: {
      const _exhaustive: never = format;
      throw new Error(`[formatExtension] unsupported format: ${_exhaustive as string}`);
    }
  }
}
