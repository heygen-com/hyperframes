import { ReviewFailed, reviewSentence } from "@hyperframes/share";
import { isAuthError } from "../auth/errors.js";

const HINTS: Record<string, string> = {
  audience_required:
    "Choose an audience with --public, --team, --invite-only or --private. --yes is not audience consent.",
  review_project_limit_reached:
    "Your workspace has used its five free shared projects. Update an existing share, or manage and remove one to free a slot. Turning a link off does not free a slot.",
  review_subscription_required:
    "That sharing option is not included in this workspace's plan. Choose an available audience explicitly or manage your plan.",
  workspace_mismatch:
    "This folder already shares into another workspace. Manage the existing share instead of changing its identity.",
  manage_existing_audience:
    "Manage this existing share to change its audience. Copying or updating a share preserves its settings.",
  not_shared:
    "This project has no shared review yet. Run hyperframes share with an explicit audience.",
};
export function shareError(error: unknown): { code: string; message: string } {
  if (isAuthError(error))
    return {
      code: error.code.toLowerCase(),
      message: `${error.message} ${error.hint ?? ""}`.trim(),
    };
  if (error instanceof ReviewFailed)
    return {
      code: error.reason || "share_failed",
      message: HINTS[error.reason] ?? reviewSentence(error),
    };
  return {
    code: "share_failed",
    message: error instanceof Error ? error.message : "Sharing failed. Try again.",
  };
}
