export type RenderOutputFormat = "mp4" | "webm" | "mov" | "png-sequence" | "gif";

export function outputNeedsAlpha(format: RenderOutputFormat): boolean {
  return format !== "mp4";
}

export function outputSupportsPageSideShaderCompositing(format: RenderOutputFormat): boolean {
  return format === "mp4" || format === "gif";
}
