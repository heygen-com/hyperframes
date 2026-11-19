import type { LocalShareAction, LocalShareSnapshot } from "@hyperframes/studio-server";
import { audienceLabel } from "./ShareAudience";

/**
 * What the person agrees to before Studio shares anything: which review it touches and who can open it. A project's
 * own `.hyperframes/review.json` can point at an existing review, so the review is always named.
 */
export function shareConfirmMessage(
  action: LocalShareAction,
  snapshot: LocalShareSnapshot,
  spaceId: string,
): string {
  const { share } = snapshot;
  const review = `Review: ${share.url ?? share.manageUrl}`;
  const current = share.audience ? `Who can open it: ${audienceLabel(share.audience)}` : "";
  const files =
    action.includeSource && !action.videoOnly
      ? "Includes editable project files, unused and Git-ignored files too."
      : "";
  const lines = (...parts: string[]) => parts.filter(Boolean).join("\n");
  switch (action.action) {
    case "share": {
      const space = snapshot.spaces.find((item) => item.id === spaceId);
      return lines(
        "Create a share link for this project?",
        "",
        action.audience ? `Who can open it: ${audienceLabel(action.audience)}` : "",
        space ? `Workspace: ${space.name}` : "",
        files,
      );
    }
    case "update":
      return lines(
        "Upload this project as a new version of this shared review?",
        "",
        review,
        current,
        files,
      );
    case "access":
      return lines(
        "Change who can open this shared review?",
        "",
        review,
        share.audience ? `Now: ${audienceLabel(share.audience)}` : "",
        action.audience ? `After: ${audienceLabel(action.audience)}` : "",
      );
    case "on":
      return lines("Turn this review's link back on?", "", review, current);
    case "off":
      return lines(
        "Turn off this link? Everyone using the link loses access. Comments are kept.",
        "",
        review,
      );
    case "login":
      return "";
  }
}
