import type { CommitMutationOptions, MutationResult } from "../hooks/gsapScriptCommitTypes";
import { trackStudioEvent } from "./studioTelemetry";

export type KeyframeUsageAction = "add" | "convert" | "remove_all" | "reset";

export function keyframeUsageActions(
  mutations: ReadonlyArray<Record<string, unknown>>,
): Set<KeyframeUsageAction> {
  const actions = new Set<KeyframeUsageAction>();
  for (const mutation of mutations) {
    switch (mutation.type) {
      case "add-keyframe":
      case "add-with-keyframes":
        actions.add("add");
        break;
      case "convert-to-keyframes":
        actions.add("convert");
        break;
      case "remove-all-keyframes":
        actions.add("remove_all");
        break;
    }
  }
  return actions;
}

export function trackKeyframeUsage(action: KeyframeUsageAction, property?: string): void {
  trackStudioEvent("keyframe", property === undefined ? { action } : { action, property });
}

export function primaryKeyframeAction(
  actions: ReadonlySet<KeyframeUsageAction>,
): KeyframeUsageAction | undefined {
  return (["add", "convert", "remove_all", "reset"] as const).find((action) => actions.has(action));
}

export function trackKeyframeCommit(
  mutations: ReadonlyArray<Record<string, unknown>>,
  result: MutationResult,
  options: CommitMutationOptions,
): void {
  if (!result.ok || result.changed !== true || options.keyframeTelemetry === false) return;
  const action = options.keyframeAction ?? primaryKeyframeAction(keyframeUsageActions(mutations));
  if (action) trackKeyframeUsage(action, action === "add" ? options.keyframeProperty : undefined);
}
