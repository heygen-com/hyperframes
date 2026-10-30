let pageCrashed = false;

export function notePageCrash(): void {
  pageCrashed = true;
}

const CLOSED_AFTER_CRASH = /Target closed|detached Frame|Session closed/;

function namedAfterCrash(message: string): string {
  return pageCrashed && CLOSED_AFTER_CRASH.test(message)
    ? `The browser page crashed, most likely out of memory: ${message}`
    : message;
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return namedAfterCrash(error.message);
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(error) ?? `{${Object.keys(error).join(", ")}}`;
    } catch {
      try {
        return `{${Object.keys(error as object).join(", ")}}`;
      } catch {
        /* truly opaque object */
      }
    }
  }
  return String(error ?? "unknown error");
}

const PROTOCOL_TIMEOUT_ADVICE =
  / Increase the 'protocolTimeout' setting in launch\/connect calls[^.]*\./;

export async function atStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Error && !error.message.includes(` (while ${step})`)) {
      error.message = error.message.replace(PROTOCOL_TIMEOUT_ADVICE, "") + ` (while ${step})`;
    }
    throw error;
  }
}
