import { isTransientBrowserError } from "@hyperframes/engine";

/** Takes a screenshot again, once, when Chrome refuses it for a passing reason (it dropped the frame mid-paint). A
 * second failure reports the first error. */
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
