import { rmSync } from "node:fs";
import { rm } from "node:fs/promises";

// Windows holds files for a moment after a process exits or while antivirus scans them (EBUSY,
// EPERM, ENOTEMPTY). Node retries those itself when asked: about 5.5 s in all.
const RETRY = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } as const;

type RemoveSync = (path: string, options: typeof RETRY) => void;
type RemoveAsync = (path: string, options: typeof RETRY) => Promise<void>;
type Warn = (message: string) => void;

function refusal(path: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `[cleanup] could not remove ${path}: ${reason}`;
}

/** Removes a tree the next step needs gone, riding out transient locks; throws if it still fails. */
export function removeTreeWithRetry(path: string, remove: RemoveSync = rmSync): void {
  remove(path, RETRY);
}

/** Async twin of {@link removeTreeWithRetry}. */
export async function removeTreeWithRetryAsync(
  path: string,
  remove: RemoveAsync = rm,
): Promise<void> {
  await remove(path, RETRY);
}

/** Cleans up after finished work: a refusal that outlasts the retries is warned about, never thrown. */
export function removeTreeBestEffort(
  path: string,
  options: { remove?: RemoveSync; warn?: Warn } = {},
): void {
  try {
    removeTreeWithRetry(path, options.remove);
  } catch (error) {
    (options.warn ?? console.warn)(refusal(path, error));
  }
}

/** Async twin of {@link removeTreeBestEffort}. */
export async function removeTreeBestEffortAsync(
  path: string,
  options: { remove?: RemoveAsync; warn?: Warn } = {},
): Promise<void> {
  try {
    await removeTreeWithRetryAsync(path, options.remove);
  } catch (error) {
    (options.warn ?? console.warn)(refusal(path, error));
  }
}
