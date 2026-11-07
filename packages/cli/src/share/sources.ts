import { projectFingerprint, shareSources, type VersionRequest } from "@hyperframes/share";
import type { createShareAccess } from "./auth.js";
import { latestShareRender, shareContentFingerprint } from "./render.js";

export class ShareSourceError extends Error {}

export type ShareSourceState =
  | { at: "not_checked" }
  | { at: "video_only"; reason: string }
  | { at: "ready"; snapshot: { space_id: string; composition_id: string; snapshot_id: string } };
export interface PreparedShareSource {
  source: ShareSourceState;
  filesForExport?: VersionRequest["filesForExport"];
  requireSource: boolean;
}
const unavailablePlans = new Set([
  "source_disabled",
  "source_plan_required",
  "source_composition_limit",
]);
export function uncheckedSource(): ShareSourceState {
  return { at: "not_checked" };
}
export async function prepareCliShareSource(
  dir: string,
  access: ReturnType<typeof createShareAccess>["access"],
  spaceId: string | undefined,
  options: { videoOnly?: boolean; shareFiles: boolean },
): Promise<PreparedShareSource> {
  if (options.videoOnly) return videoOnly("requested");
  if (!options.shareFiles) return videoOnly("source_disabled");
  if (!spaceId) throw new Error("The owning workspace could not be verified. Retry sharing.");
  try {
    const render = latestShareRender(dir);
    const source = shareSources({
      access,
      spaceId,
      fingerprint: async (path) =>
        render?.contentFingerprint === (await shareContentFingerprint(path))
          ? projectFingerprint(path)
          : null,
    });
    const prepared = await source.prepare(dir, render?.fingerprint ?? null);
    if (prepared.at === "ready")
      return { source: prepared, filesForExport: source.filesForExport, requireSource: true };
    if (unavailablePlans.has(prepared.reason)) return videoOnly(prepared.reason);
    throw new Error(`Source could not be attached (${prepared.reason}).`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Source upload failed.";
    throw new ShareSourceError(
      `${reason} Retry sharing, or use --video-only to share just the video.`,
      {
        cause: error,
      },
    );
  }
}
function videoOnly(reason: string): PreparedShareSource {
  return { source: { at: "video_only", reason }, requireSource: false };
}
