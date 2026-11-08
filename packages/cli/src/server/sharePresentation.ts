import type { LocalShareSpace, LocalShareState } from "@hyperframes/studio-server";
import { shareSite } from "../share/auth.js";
import type { ShareService, ShareState } from "../share/service.js";

export function presentShare(value: ShareState): LocalShareState {
  const held =
    value.share?.held ||
    value.share?.takedown ||
    value.share?.sharingState?.state === "subscription_required";
  return {
    state: presentedState(value, Boolean(held)),
    url: held ? null : (value.url ?? value.previousUrl),
    failure: value.state === "failed" ? value.version.failure : null,
    hasReadyVersion: value.ready || Boolean(value.previousUrl),
    manageUrl: value.manageUrl,
    // Desktop's watcher does not cover every portable render input.
    changed: knownChanges(value),
    audience: value.share?.access ?? null,
    spaceId: value.share?.space?.id ?? null,
    source: value.source.at,
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
    ...planOffer(space.review_entitlements),
    audiences: [
      "private",
      ...(space.review_entitlements?.allowed_collaborative_access_modes ?? []),
    ],
    used: space.review_entitlements?.projects_used_up_to_limit ?? null,
    limit: space.review_entitlements?.project_limit ?? null,
  }));
}

function knownChanges(value: ShareState): boolean | null {
  if (!value.share) return false;
  return value.version.last && !value.version.last.current ? true : null;
}

function planOffer(
  entitlements: Awaited<ReturnType<ShareService["spaces"]>>[number]["review_entitlements"],
) {
  const plan = entitlements?.plan ?? null;
  return { plan, upgradeUrl: plan === "free" ? `${shareSite()}/pricing` : null };
}

function presentedState(value: ShareState, held: boolean): LocalShareState["state"] {
  if (held) return "unavailable";
  if (value.state === "failed" || value.state === "not_shared" || value.state === "link_off")
    return value.state;
  return value.ready ? "ready" : "processing";
}
