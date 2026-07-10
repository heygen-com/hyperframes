import { getStudioSaveErrorMessage, getStudioSaveStatusCode } from "./studioSaveDiagnostics";

interface DomEditSaveQueueOpenEvent {
  consecutiveFailures: number;
  errorMessage: string;
  statusCode: number | null;
}

interface DomEditSaveQueueOptions {
  failureThreshold?: number;
  onOpen?: (event: DomEditSaveQueueOpenEvent) => void;
  onReset?: () => void;
}

export interface DomEditSaveQueue {
  enqueue: <T>(save: () => Promise<T>) => Promise<T>;
  waitForIdle: () => Promise<void>;
  reset: () => void;
  destroy: () => void;
}

const DEFAULT_FAILURE_THRESHOLD = 5;

export class DomEditSaveQueueOpenError extends Error {
  constructor() {
    super("Auto-save is paused. Dismiss the warning to retry DOM edits.");
    this.name = "DomEditSaveQueueOpenError";
  }
}

export function createDomEditSaveQueue(options: DomEditSaveQueueOptions = {}): DomEditSaveQueue {
  const failureThreshold = options.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;

  let tail = Promise.resolve();
  let consecutiveFailures = 0;
  let breakerOpen = false;

  const reset = (notify = true) => {
    const wasOpen = breakerOpen;
    consecutiveFailures = 0;
    breakerOpen = false;
    if (notify && wasOpen) options.onReset?.();
  };

  const open = (error: unknown) => {
    if (breakerOpen) return;
    breakerOpen = true;
    options.onOpen?.({
      consecutiveFailures,
      errorMessage: getStudioSaveErrorMessage(error),
      statusCode: getStudioSaveStatusCode(error) ?? null,
    });
  };

  const run = async <T>(save: () => Promise<T>): Promise<T> => {
    try {
      const result = await save();
      if (!breakerOpen) consecutiveFailures = 0;
      return result;
    } catch (error) {
      consecutiveFailures += 1;
      if (getStudioSaveStatusCode(error) === 409 || consecutiveFailures >= failureThreshold)
        open(error);
      throw error;
    }
  };

  return {
    enqueue(save) {
      if (breakerOpen) return Promise.reject(new DomEditSaveQueueOpenError());
      const queued = tail.catch(() => undefined).then(() => run(save));
      tail = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },

    async waitForIdle() {
      await tail.catch(() => undefined);
    },

    reset,

    destroy() {
      reset(false);
    },
  };
}
