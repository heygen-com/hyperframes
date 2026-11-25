import { previewChangesOutsideTextSaves } from "../player/previewReloading";
import { savedTextIn, type TextTargets } from "./textSaves";
import type { DomEditPersistOutcome } from "./domEditCommitTypes";

interface DomEditCommitRunnerConfig {
  capture: () => void;
  apply: () => void;
  persist: () => Promise<unknown>;
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
  /** Always runs once after persistence, resync, or an unexpected runner error. */
  onFinally?: () => void;
}

interface CommitVersionRef {
  current: number;
}

export function bumpDomEditCommitVersion(versionRef: CommitVersionRef): () => boolean {
  const commitVersion = versionRef.current + 1;
  versionRef.current = commitVersion;
  return () => versionRef.current === commitVersion;
}

export interface DomEditCommitVersionGuard {
  (): boolean;
  release: () => void;
}

export interface TextWriteOrder extends TextTargets {
  claims: Map<string, number>;
  chains: Map<string, Promise<void>>;
}

export const textWriteOrder = (): TextWriteOrder => ({
  claims: new Map(),
  chains: new Map(),
  landed: new Map(),
  writing: new Map(),
});

export type TextWriteClaim = DomEditCommitVersionGuard & {
  write: <T>(run: () => Promise<T>) => Promise<T>;
  /** Settles once every earlier claim's write on the key has released. */
  turn: () => Promise<void>;
  /** The persistence guard: a false answer also marks this write as skipped. */
  shouldSave: () => boolean;
  /** Records `markup` as what the file holds, unless the write was skipped or the preview changed since the claim. */
  landed: (markup: string) => void;
  /** What the file holds for the key, as far as this pipeline saw it reach the file since the preview last changed. */
  saved: () => string | undefined;
  /** Whether an earlier save on the key could have drawn after this save's caller read the element. */
  followed: () => boolean;
};

/**
 * Claims `key` for a save numbered at its request; null when a later-numbered save already claimed it, unless the
 * save composes. Writes to one key run one after another in claim order.
 */
export function claimTextWrite(
  order: TextWriteOrder,
  key: string,
  number: number,
  onSettled?: () => void,
  /** A field-scoped save rebuilds on what landed at its turn, so a newer claim never makes it stale. */
  composes = false,
): TextWriteClaim | null {
  const newest = order.claims.get(key) ?? 0;
  if (!composes && newest > number) return null;
  order.claims.set(key, Math.max(newest, number));
  const changes = previewChangesOutsideTextSaves();
  const followed = order.chains.has(key);
  const before = order.chains.get(key) ?? Promise.resolve();
  let open!: () => void;
  const slot = new Promise<void>((resolve) => (open = resolve));
  order.chains.set(key, slot);
  order.writing.set(key, (order.writing.get(key) ?? 0) + 1);
  let released = false;
  let skipped = false;
  const release = () => {
    if (released) return;
    released = true;
    open();
    if (order.chains.get(key) === slot) order.chains.delete(key);
    order.writing.set(key, order.writing.get(key)! - 1);
    onSettled?.();
  };
  const isLatest = () => order.claims.get(key) === number;
  return Object.assign(isLatest, {
    release,
    // The commit's onFinally releases, after its revert, so the next turn never sees a failed draw.
    write: <T>(run: () => Promise<T>) => before.then(run),
    turn: () => before,
    shouldSave: () => isLatest() || !(skipped = true),
    landed: (markup: string) => {
      const last = order.landed.get(key);
      if (skipped || previewChangesOutsideTextSaves() !== changes) return;
      if (!composes && last?.changes === changes && last.number > number) return;
      order.landed.set(key, { number, markup, changes });
    },
    saved: () => savedTextIn(order, key),
    followed: () => followed || savedTextIn(order, key) !== undefined,
  });
}

export function bumpDomEditCommitMapVersion<TKey>(
  versionMap: Map<TKey, symbol>,
  versionKey: TKey,
): DomEditCommitVersionGuard {
  const commitVersion = Symbol("dom-edit-commit");
  versionMap.set(versionKey, commitVersion);
  const isLatest = () => versionMap.get(versionKey) === commitVersion;
  return Object.assign(isLatest, {
    release: () => {
      if (isLatest()) versionMap.delete(versionKey);
    },
  });
}

export async function runDomEditCommit(config: DomEditCommitRunnerConfig): Promise<void> {
  try {
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
  } finally {
    config.onFinally?.();
  }
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

export type DomEditCommitOutcome =
  | { ok: true; persistence?: DomEditPersistOutcome; changed?: boolean }
  | { ok: false; reason: DomEditCommitDeclineReason };

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
  let persistence: DomEditPersistOutcome | undefined;
  await runDomEditCommit({
    ...config,
    persist: async () => {
      const result = await config.persist();
      if (isDomEditPersistOutcome(result)) persistence = result;
    },
    onSettled: (ok) => {
      landed = ok;
      config.onSettled?.(ok);
    },
  });
  if (!landed) return domEditCommitDeclined("persist-failed");
  return persistence ? { ok: true, persistence } : { ok: true };
}

function isDomEditPersistOutcome(value: unknown): value is DomEditPersistOutcome {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof Reflect.get(value, "sourceFile") === "string" &&
    typeof Reflect.get(value, "version") === "string" &&
    typeof Reflect.get(value, "changed") === "boolean"
  );
}
