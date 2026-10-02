import type {
  CommitMutationCall,
  CommitMutation,
  CommitMutationOptions,
  MutationResult,
} from "./gsapScriptCommitTypes";
import {
  keyframeUsageActions,
  primaryKeyframeAction,
  trackKeyframeUsage,
  type KeyframeUsageAction,
} from "../utils/keyframeUsage";
import type { GeometryCommitResult } from "../utils/previewFeatureUsage";

export function observeGsapGesture(writer: CommitMutation | null) {
  let changed = false;
  let pendingResults = 0;
  const actions = new Set<KeyframeUsageAction>();
  const observe = (calls: CommitMutationCall[], options: CommitMutationOptions) => {
    pendingResults += 1;
    return {
      ...options,
      keyframeTelemetry: false,
      onResult: (result: MutationResult) => {
        pendingResults -= 1;
        options.onResult?.(result);
        if (!result.ok || result.changed !== true) return;
        changed = true;
        for (const call of calls) {
          if (call.options.keyframeAction) actions.add(call.options.keyframeAction);
          else for (const action of keyframeUsageActions([call.mutation])) actions.add(action);
        }
      },
    };
  };
  let commit: CommitMutation | null = null;
  if (writer) {
    commit = (selection, mutation, options) =>
      writer(selection, mutation, observe([{ selection, mutation, options }], options));
    if (writer.batch) {
      const batch = writer.batch;
      commit.batch = (calls, options) => batch(calls, observe(calls, options));
    }
  }
  return {
    commit,
    recordDomResult: (result: { changed: boolean } | undefined) => {
      changed ||= result?.changed === true;
    },
    finish: (domChanged = false): GeometryCommitResult => {
      if (pendingResults !== 0) return { ok: true, changed: false };
      const action = primaryKeyframeAction(actions);
      if (action) trackKeyframeUsage(action);
      return { ok: true, changed: changed || domChanged };
    },
  };
}
