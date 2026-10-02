import type {
  CommitMutation,
  CommitMutationOptions,
  MutationResult,
} from "./gsapScriptCommitTypes";
import {
  keyframeUsageActions,
  trackKeyframeUsage,
  type KeyframeUsageAction,
} from "../utils/keyframeUsage";
import type { GeometryCommitResult } from "../utils/previewFeatureUsage";

export function observeGsapGesture(writer: CommitMutation | null) {
  let changed = false;
  let pendingResults = 0;
  const actions = new Set<KeyframeUsageAction>();
  const observe = (mutations: Record<string, unknown>[], options: CommitMutationOptions) => {
    pendingResults += 1;
    return {
      ...options,
      keyframeTelemetry: false,
      onResult: (result: MutationResult) => {
        pendingResults -= 1;
        options.onResult?.(result);
        if (!result.ok || result.changed === false) return;
        changed = true;
        if (options.keyframeAction) actions.add(options.keyframeAction);
        else for (const action of keyframeUsageActions(mutations)) actions.add(action);
      },
    };
  };
  let commit: CommitMutation | null = null;
  if (writer) {
    commit = (selection, mutation, options) =>
      writer(selection, mutation, observe([mutation], options));
    if (writer.batch) {
      const batch = writer.batch;
      commit.batch = (calls, options) =>
        batch(
          calls,
          observe(
            calls.map((call) => call.mutation),
            options,
          ),
        );
    }
  }
  return {
    commit,
    finish: (domChanged = false): GeometryCommitResult => {
      if (pendingResults !== 0) return { ok: true, changed: false };
      const action = (["add", "convert", "remove_all", "reset"] as const).find((candidate) =>
        actions.has(candidate),
      );
      if (action) trackKeyframeUsage(action);
      return { ok: true, changed: changed || domChanged };
    },
  };
}
