import type { CaptureWarning } from "../types.js";

/** Clone every mutable field before a warning crosses an async or ownership boundary. */
export function cloneCaptureWarning<T extends CaptureWarning>(warning: T): T {
  return {
    ...warning,
    details: warning.details
      ? {
          ...warning.details,
          sources: warning.details.sources ? [...warning.details.sources] : undefined,
          failureReasons: warning.details.failureReasons
            ? [...warning.details.failureReasons]
            : undefined,
          failureStages: warning.details.failureStages
            ? [...warning.details.failureStages]
            : undefined,
        }
      : undefined,
  } as T;
}

export function cloneCaptureWarnings<T extends CaptureWarning>(warnings: readonly T[]): T[] {
  return warnings.map(cloneCaptureWarning);
}
