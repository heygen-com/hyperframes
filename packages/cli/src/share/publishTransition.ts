import { resolve } from "node:path";
import { CliUsageError } from "../utils/commandResult.js";
import { asNotice } from "../utils/jsonError.js";
import { readProjectLink, readTeamProject } from "../utils/projectLink.js";

/** Set to the announced notice release's UTC timestamp in the release PR, after launch gates pass. */
const PUBLISH_NOTICE_RELEASE: string | null = null;
const PUBLISH_COMPATIBILITY_DAYS = 60;

export function publishPhase(
  start: string | null,
  now: number = Date.now(),
): "unscheduled" | "compatibility" | "share" {
  if (!start) return "unscheduled";
  const begins = Date.parse(start);
  if (!Number.isFinite(begins)) throw new Error("Invalid publish transition release timestamp.");
  if (now < begins) return "unscheduled";
  return now < begins + PUBLISH_COMPATIBILITY_DAYS * 86_400_000 ? "compatibility" : "share";
}
export function publishTransitionDecision(
  phase: ReturnType<typeof publishPhase>,
  legacyUpdate: boolean,
) {
  if (phase === "share" && !legacyUpdate) return "guide_to_share";
  return "keep_legacy";
}
export function checkPublishTransition(
  args: { dir?: string; update?: string },
  noticeRelease: string | null = PUBLISH_NOTICE_RELEASE,
): ReturnType<typeof publishPhase> {
  const dir = resolve(args.dir ?? ".");
  const prior = readProjectLink(dir);
  const legacyUpdate = Boolean(
    args.update?.trim() || prior?.url || readTeamProject(dir)?.projectId,
  );
  const phase = publishPhase(noticeRelease);
  asNotice(() => process.stderr.write(publishNotice(phase, legacyUpdate) + "\n"));
  if (publishTransitionDecision(phase, legacyUpdate) === "guide_to_share") {
    throw new CliUsageError(
      "New projects now use hyperframes share. Run it from this project folder and choose an audience; for scripts pass --public, --team, --invite-only or --private explicitly.",
      {
        code: "publish_replaced",
        hint: "Existing publications remain reachable. Use publish --update <url|id> for a legacy update. --yes and legacy --public do not convert a project or consent to a new review audience.",
      },
    );
  }
  return phase;
}

export function assertLegacyPublishOwner(
  phase: ReturnType<typeof publishPhase>,
  signedIn: boolean,
): void {
  if (phase === "share" && !signedIn)
    throw new CliUsageError(
      "Updating an existing publication requires a signed-in account. Run hyperframes auth login, then retry.",
      {
        code: "legacy_publish_login_required",
        hint: "Without a login, publishing would create a new project instead of updating the existing URL.",
      },
    );
}
function publishNotice(phase: ReturnType<typeof publishPhase>, update: boolean): string {
  const kept = update
    ? " This run uses the legacy update workflow."
    : " This run keeps legacy publishing behavior.";
  if (phase === "unscheduled")
    return (
      "For new video reviews, use hyperframes share. The legacy publish transition date has not been scheduled." +
      kept
    );
  if (phase === "compatibility")
    return (
      "Legacy publish is in its 60-day compatibility window. Use hyperframes share for new video reviews." +
      kept
    );
  return (
    "New projects use hyperframes share. Existing published URLs and explicit legacy updates remain supported." +
    (update ? kept : "")
  );
}
