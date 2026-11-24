// @ts-check

/** @typedef {{ read: (dir: string) => Promise<"yes" | "no" | null>,
 *   published: (dir: string, since: number) => Promise<void>, now: () => number }} FromReview */

/** @param {FromReview} host @param {string} dir */
export async function readFromReview(host, dir) {
  const since = host.now();
  try {
    const value = await host.read(dir);
    return { since, ...(value && { value }) };
  } catch (error) {
    console.error("[share] review mark not read:", error);
    return { since };
  }
}

/** Clear activity through the start of the successful share, keeping anything recorded later.
 * @param {FromReview | null} host @param {string} dir @param {number | undefined} since */
export async function sharedFromReview(host, dir, since) {
  if (!host || since === undefined) return;
  try {
    await host.published(dir, since);
  } catch (error) {
    console.error("[share] review mark not cleared:", error);
  }
}
