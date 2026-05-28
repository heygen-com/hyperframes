/**
 * Shared status-string colorizer used by `cloud list/get/render`.
 * Extracted so changes to the color palette propagate atomically; without
 * this, fallow flagged the repeated switch as duplication.
 */

import { c } from "../ui/colors.js";
import type { HyperframesRenderStatus } from "./_gen/types.js";

export function colorStatus(status: HyperframesRenderStatus | string): string {
  switch (status) {
    case "completed":
      return c.success(status);
    case "failed":
      return c.error(status);
    case "rendering":
      return c.progress(status);
    default:
      return c.dim(status);
  }
}
