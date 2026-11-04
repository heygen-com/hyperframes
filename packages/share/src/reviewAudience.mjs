// @ts-check
import { ReviewFailed } from "./reviewClient.mjs";

/** @param {import("./types/reviewWire.js").ReviewEntitlements | null | undefined} entitlements
 * @param {import("./types/share.js").AccessMode | undefined} chosen */
export function firstReviewAudience(entitlements, chosen) {
  // An omitted field is the legacy server contract; explicit null is an unavailable read.
  if (entitlements === undefined) return chosen ?? "team";
  if (!entitlements) throw new ReviewFailed(503, "review_entitlement_unavailable");
  const audience =
    chosen ?? (entitlements.allowed_collaborative_access_modes.includes("team") ? "team" : null);
  if (!audience)
    throw new ReviewFailed(402, "review_public_consent_required", undefined, undefined, {
      reason: "review_public_consent_required",
      workspace_id: entitlements.workspace_id,
    });
  if (audience !== "private" && !entitlements.allowed_collaborative_access_modes.includes(audience))
    throw new ReviewFailed(402, "review_subscription_required", undefined, undefined, {
      reason: "review_subscription_required",
      workspace_id: entitlements.workspace_id,
      requested_feature: audience,
    });
  return audience;
}
