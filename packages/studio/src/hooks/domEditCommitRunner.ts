interface DomEditCommitRunnerConfig {
  capture: () => void;
  apply: () => void;
  persist: () => Promise<void>;
  shouldRevert: (error: unknown) => boolean;
  revert: () => void;
  onError: (error: unknown) => void;
  shouldResync: () => boolean;
  resync: () => void | Promise<void>;
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
  } catch (error) {
    if (config.shouldRevert(error)) {
      config.revert();
    }
    config.onError(error);
  }

  if (!config.shouldResync()) return;
  await config.resync();
}
