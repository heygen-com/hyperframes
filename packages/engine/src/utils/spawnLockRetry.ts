// Windows throws EBUSY (POSIX: ETXTBSY) from spawn() itself while another process holds the
// executable open, e.g. antivirus; nothing has started, so running the caller again is safe.
const LOCKED_EXECUTABLE_CODES = new Set(["EBUSY", "ETXTBSY"]);
const RETRY_DELAYS_MS = [250, 500];

// Errors this module has already given up on. An outer retry wrapper must not
// treat them as a fresh lock, or nested wrappers multiply the attempts.
const exhaustedErrors = new WeakSet<object>();

function isLockedExecutableSpawn(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    !exhaustedErrors.has(error) &&
    "syscall" in error &&
    error.syscall === "spawn" &&
    "code" in error &&
    typeof error.code === "string" &&
    LOCKED_EXECUTABLE_CODES.has(error.code)
  );
}

/** Runs `run`, again after a short wait each time it fails because `binary` was locked. */
export async function retrySpawnWhileLocked<T>(binary: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isLockedExecutableSpawn(error)) throw error;
      const delayMs = RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) {
        const exhausted = Object.assign(
          new Error(
            `[FFmpeg] Could not start "${binary}" (${error.code}) after ${attempt + 1} attempts: ` +
              "another process kept the executable open, often antivirus scanning it.",
            { cause: error },
          ),
          { code: error.code, errno: error.errno, syscall: error.syscall },
        );
        exhaustedErrors.add(exhausted);
        throw exhausted;
      }
      console.warn(
        `[FFmpeg] "${binary}" is locked (${error.code}); retrying in ${delayMs} ms (attempt ${attempt + 2}).`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
