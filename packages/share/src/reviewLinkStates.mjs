// @ts-check
// Where each share link in Settings' list stands: on, turned off, paused or taken down, and who can open it.

/** @typedef {"on" | "off" | "paused" | "taken-down"} LinkState
 * @typedef {{ state: LinkState, access: import("./types/share.js").AccessMode,
 *   pausedFor?: "report" | "plan" }} LinkStateRead */

/** One page of the list at most, so a team's list never fans out into hundreds of reads. */
const MOST = 50;
const AT_ONCE = 4;

/** @param {import("./types/reviewWire.js").ShareDTO} share @returns {LinkStateRead} */
export function linkStateOf(share) {
  const access = share.access_mode;
  if (share.revoked) return { state: "off", access };
  if (share.moderation_hold)
    return share.moderation_hold_kind === "takedown"
      ? { state: "taken-down", access }
      : { state: "paused", access, pausedFor: "report" };
  if (share.sharing_state?.state === "subscription_required")
    return { state: "paused", access, pausedFor: "plan" };
  return { state: "on", access };
}

/** Each project's link, read a few at a time; a read that fails leaves that project out, so its row shows no state.
 * @param {{ client: { share: (id: string) => Promise<import("./types/reviewWire.js").ShareDTO> },
 *   projectIds: string[] }} request
 * @returns {Promise<Record<string, LinkStateRead>>} */
export async function reviewLinkStates({ client, projectIds }) {
  const ids = [...new Set(projectIds)].slice(0, MOST);
  /** @type {Record<string, LinkStateRead>} */
  const states = {};
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = /** @type {string} */ (ids[next++]);
      try {
        states[id] = linkStateOf(await client.share(id));
      } catch (error) {
        // expected: one unreadable link leaves its row without a state; the rest of the list still shows theirs.
        console.warn("[review] link state not read:", /** @type {any} */ (error)?.reason ?? error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, ids.length) }, worker));
  return states;
}
