import type { LeftOutReference } from "../utils/leftOutReference.js";
import { trackEvent } from "./client.js";

export type LeftOutCommand = "publish" | "cloud_render" | "feedback";

/** What an upload left out, as counts and folder depths: never a name or a path. */
function leftOutCounts(references: readonly LeftOutReference[]) {
  const levels = references.map((reference) => reference.levels_up);
  const counted = (keep: (levels: number | null) => boolean) => levels.filter(keep).length;
  return {
    left_out_count: references.length,
    received_count: references.filter((reference) => reference.reason === "received").length,
    blocklisted_count: references.filter((reference) => reference.reason === "blocklisted").length,
    file_type_count: references.filter((reference) => reference.reason === "file_type").length,
    max_levels_up: Math.max(0, ...levels.map((n) => n ?? 0)),
    levels_up_1: counted((n) => n === 1),
    levels_up_2: counted((n) => n === 2),
    levels_up_3_plus: counted((n) => n !== null && n >= 3),
    other_drive: counted((n) => n === null),
  };
}

/** Sent once per upload that left something out; `dryRun` marks a `cloud render --dry-run` that uploaded nothing. */
export function trackUploadLeftOut(
  command: LeftOutCommand,
  references: readonly LeftOutReference[],
  dryRun = false,
): void {
  if (references.length === 0) return;
  trackEvent("cli_upload_left_out", { command, dry_run: dryRun, ...leftOutCounts(references) });
}
