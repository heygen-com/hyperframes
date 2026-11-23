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

export class SetupStepsError extends Error {
  constructor(
    readonly summary: string,
    readonly stepsWrittenByCli: string,
  ) {
    super(`${summary}\n\n${stepsWrittenByCli}`);
  }
}

export const LINUX_ARM_BROWSER_STEPS =
  `Install Chromium manually and point hyperframes to it:\n\n` +
  `  sudo apt-get install -y chromium-browser\n` +
  `  export HYPERFRAMES_BROWSER_PATH=$(which chromium-browser)\n\n` +
  `Then re-run your command. The HYPERFRAMES_BROWSER_PATH env var persists for the session.`;

export function splitStepsWrittenByCli(message: string): {
  summary: string;
  stepsWrittenByCli?: string;
} {
  const joined = `\n\n${LINUX_ARM_BROWSER_STEPS}`;
  const at = message.indexOf(joined);
  if (at === -1) return { summary: message };
  return {
    summary: message.slice(0, at) + message.slice(at + joined.length),
    stepsWrittenByCli: LINUX_ARM_BROWSER_STEPS,
  };
}

export const stackOrMessage = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

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
