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

export function trackKeyframeMutations(
  mutations: ReadonlyArray<Record<string, unknown>>,
  property?: string,
): void {
  for (const action of keyframeUsageActions(mutations))
    trackKeyframeUsage(action, action === "add" ? property : undefined);
}
