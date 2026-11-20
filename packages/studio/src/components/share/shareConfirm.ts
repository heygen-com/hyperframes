import type { LocalShareAction, LocalShareSnapshot } from "@hyperframes/studio-server";
import { audienceLabel } from "./ShareAudience";

/**
 * What the person agrees to before Studio shares anything: which review it touches and who can open it. A project's
 * own review record can point at an existing review, so the review is always named.
 */
export function shareConfirmMessage(
  action: LocalShareAction,
  snapshot: LocalShareSnapshot,
  spaceId: string,
): string {
  const { share } = snapshot;
  const linked = action.action === "share" && share.reviewId !== null;
  const space = snapshot.spaces.find(
    (item) => item.id === (share.spaceId ?? (linked ? null : spaceId)),
  );
  const lines = (...parts: string[]) => parts.filter(Boolean).join("\n");
  const ask = (question: string, body: string) => (body ? `${question}\n\n${body}` : question);
  const details = (...parts: string[]) =>
    lines(
      share.reviewId
        ? `Review: ${share.reviewTitle ? quoted(share.reviewTitle) : "(title not available)"}`
        : "",
      share.url ? `Link: ${share.url}` : "",
      space ? `Workspace: ${space.name}` : "",
      ...parts,
    );
  const who = (audience?: LocalShareAudience) =>
    audience ? `Who can open it: ${audienceLabel(audience)}` : "";
  const files =
    action.includeSource && !action.videoOnly
      ? "Includes editable project files, unused and Git-ignored files too."
      : "";
  switch (action.action) {
    case "share":
      return ask(
        linked
          ? "This folder is already linked to an existing review. Sharing adds this video to it and sets who can open it. If you didn't share this project before, cancel: it may have come with a folder someone sent you."
          : "Create a share link for this project?",
        details(who(action.audience), files),
      );
    case "update":
      return ask(
        firstUpload(snapshot)
          ? "Create the share link for this review?"
          : "Upload this project as a new version of this shared review?",
        details(who(share.audience ?? undefined), files),
      );
    case "access":
      return ask(
        "Change who can open this shared review?",
        details(
          share.audience ? `Now: ${audienceLabel(share.audience)}` : "",
          action.audience ? `After: ${audienceLabel(action.audience)}` : "",
        ),
      );
    case "on":
      return ask("Turn this review's link back on?", details(who(share.audience ?? undefined)));
    case "off":
      return ask(
        "Turn off this link? Everyone using the link loses access. Comments are kept.",
        details(),
      );
    case "login":
      return "";
  }
}

type LocalShareAudience = NonNullable<LocalShareAction["audience"]>;

function quoted(title: string) {
  const line = title.replace(/[\p{C}\p{Z}\s]+/gu, " ").trim();
  return `"${line.length > 80 ? `${line.slice(0, 79)}…` : line}"`;
}

function firstUpload({ share, job }: LocalShareSnapshot) {
  return (job?.state === "failed" || share.state === "failed") && share.hasReadyVersion === false;
}
