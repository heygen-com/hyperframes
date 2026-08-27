interface DomEditCommitRunnerConfig {
  capture: () => void;
  apply: () => void;
  persist: () => Promise<void>;
  shouldRevert: (error: unknown) => boolean;
  revert: () => void;
  onError: (error: unknown) => void;
  shouldResync: () => boolean;
  resync: () => void | Promise<void>;
  /**
   * Reports success/failure without changing this function's own resolve-
   * always contract — `persist` failures are handled here (revert + onError)
   * and never rethrown, so callers awaiting `runDomEditCommit` can't observe
   * failure via rejection. A caller that needs to react to a specific
   * commit's outcome (e.g. reverting its OWN optimistic state) can pass this
   * instead of relying on a rejection that will never come.
   */
  onSettled?: (ok: boolean) => void;
}

interface CommitVersionRef {
  current: number;
}

export function bumpDomEditCommitVersion(versionRef: CommitVersionRef): () => boolean {
  const commitVersion = versionRef.current + 1;
  versionRef.current = commitVersion;
  return () => versionRef.current === commitVersion;
}

export function bumpDomEditCommitMapVersion<TKey>(
  versionMap: Map<TKey, number>,
  versionKey: TKey,
): () => boolean {
  const commitVersion = (versionMap.get(versionKey) ?? 0) + 1;
  versionMap.set(versionKey, commitVersion);
  return () => versionMap.get(versionKey) === commitVersion;
}

export async function runDomEditCommit(config: DomEditCommitRunnerConfig): Promise<void> {
  config.capture();
  config.apply();

  try {
    await config.persist();
    config.onSettled?.(true);
  } catch (error) {
    if (config.shouldRevert(error)) {
      config.revert();
    }
    config.onError(error);
    config.onSettled?.(false);
  }

  if (!config.shouldResync()) return;
  await config.resync();
}

/**
 * Why a DOM edit commit did not change the file.
 *
 * `runDomEditCommit` resolves on persist failure by design (see its contract
 * above), so a caller cannot learn whether the write landed by awaiting it — a
 * failed persist and a successful one are indistinguishable. Capture and apply
 * bugs still reject. The human path does not need to ask about handled persist
 * failures, because `onError` already put a toast on screen. A programmatic
 * caller has no screen, so it has to be told.
 */
export type DomEditCommitDeclineReason =
  | "no-project"
  | "no-selection"
  | "geometry-property"
  | "styles-not-editable"
  | "not-text-editable"
  | "preview-stale"
  | "persist-failed";

export type DomEditCommitOutcome = { ok: true } | { ok: false; reason: DomEditCommitDeclineReason };

export function domEditCommitDeclined(reason: DomEditCommitDeclineReason): DomEditCommitOutcome {
  return { ok: false, reason };
}

/**
 * `runDomEditCommit`, reporting whether the write actually landed.
 *
 * Owns `onSettled` to do it, and forwards to a caller-supplied one rather than
 * dropping it. `runDomEditCommit` calls `onSettled` exactly once on both the
 * success and the failure path, so the flag is always set by the time it
 * resolves.
 */
export async function runReportedDomEditCommit(
  config: DomEditCommitRunnerConfig,
): Promise<DomEditCommitOutcome> {
  let landed = false;
  await runDomEditCommit({
    ...config,
    onSettled: (ok) => {
      landed = ok;
      config.onSettled?.(ok);
    },
  });
  return landed ? { ok: true } : domEditCommitDeclined("persist-failed");
}
