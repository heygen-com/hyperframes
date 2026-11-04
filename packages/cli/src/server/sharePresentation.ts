import type { LocalShareSpace, LocalShareState } from "@hyperframes/studio-server";
import type { ShareService, ShareState } from "../share/service.js";

export function presentShare(value: ShareState): LocalShareState {
  const held =
    value.share?.held ||
    value.share?.takedown ||
    value.share?.sharingState?.state === "subscription_required";
  return {
    state: held
      ? "unavailable"
      : value.state === "not_shared"
        ? "not_shared"
        : value.state === "link_off"
          ? "link_off"
          : value.ready
            ? "ready"
            : "processing",
    url: held ? null : value.url,
    manageUrl: value.manageUrl,
    changed: Boolean(value.share && value.version.last && !value.version.last.current),
    audience: value.share?.access ?? null,
    spaceId: value.share?.space?.id ?? null,
  };
}

export function presentSpaces(
  spaces: Awaited<ReturnType<ShareService["spaces"]>>,
): LocalShareSpace[] {
  return spaces.map((space) => ({
    id: space.space_id,
    name: space.name || (space.kind === "personal" ? "Personal workspace" : space.space_id),
    bound: space.bound === true,
    canCreate: space.can_create_review,
    audiences: [
      "private",
      ...(space.review_entitlements?.allowed_collaborative_access_modes ?? []),
    ],
    used: space.review_entitlements?.projects_used_up_to_limit ?? null,
    limit: space.review_entitlements?.project_limit ?? null,
  }));
}
