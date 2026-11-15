import { isTransientBrowserError } from "@hyperframes/engine";

/** Retries once on a passing Chrome refusal; a second failure rethrows the first error. */
export async function screenshotOnceMore<T>(shoot: () => Promise<T>): Promise<T> {
  try {
    return await shoot();
  } catch (err) {
    if (!isTransientBrowserError(err)) throw err;
    return shoot().catch(() => {
      throw err;
    });
  }
}
