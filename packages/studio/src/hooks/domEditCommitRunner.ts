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
