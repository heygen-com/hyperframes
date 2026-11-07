// @ts-check
// Files on a project's review versions after the upload: what the Share popover's files line says, and attaching the
// last sync to the version on the page when that version went up without files and the project has not changed since
// (the owner synced after rendering). A version only ever carries files that produce its video.
import { normalize } from "./host.mjs";
import { ReviewFailed } from "./reviewClient.mjs";
import { markFiles, versionFacts, versionOnPage } from "./reviewExport.mjs";

/** Files vs. the last sync: `off` (share_files or sync off), `elsewhere`
 * (syncs to `workspace`, not ours), `differs` (no sync, syncing, writing, changed), `matches` (a version can carry it).
 * @typedef {{ at: "off" } | { at: "differs" } | { at: "elsewhere", workspace: string }
 *   | { at: "matches", snapshot: import("./types/reviewWire.js").SnapshotRef }} SyncedFiles */

/** @typedef {import("./types/share.js").ReviewFiles} FilesAnswer */

/** The files line from what is known: the version on the page carrying files says so first; a project synced to
 * another workspace says which, since neither a sync nor a render here fixes it; a project moved past its render is
 * `changed`; a render not on the page yet is `included` when the version it would add carries files.
 * @param {Awaited<ReturnType<typeof versionFacts>>} facts @param {SyncedFiles} found @returns {FilesAnswer} */
export function filesStateOf({ last, source }, found) {
  if (found.at === "off") return { at: "off" };
  const onPage = last?.current ? last : null;
  if (onPage?.files && source !== "stale") return { at: "included" };
  if (found.at === "elsewhere" && (source === "ready" || source === "stale"))
    return { at: "other_workspace", workspace: found.workspace };
  if (source === "stale") return { at: "changed" };
  if (source !== "ready") return { at: onPage?.files ? "included" : "off" };
  if (onPage) return { at: "not_synced" };
  return { at: found.at === "matches" ? "included" : "not_synced" };
}

/** @param {string} versionId @param {import("./types/reviewWire.js").SnapshotRef} snapshot */
const pairOf = (versionId, snapshot) =>
  [versionId, snapshot.space_id, snapshot.composition_id, snapshot.snapshot_id].join("\0");

/** `match` answers the files line; `forRender` is the only way to files for a version, held to its render (the same
 * one an export's `filesForExport` is). @param {{ client: Pick<import("./reviewClient.mjs").ReviewClient,
 *   "attachSnapshot">, match: (projectPath: string) => Promise<SyncedFiles>,
 *   forRender: import("./reviewExport.mjs").FilesForRender }} deps */
export function reviewFiles({ client, match, forRender }) {
  /** One attach per project at a time; a second asks and joins the first. @type {Map<string, Promise<void>>} */
  const attaching = new Map();
  /** Version and snapshot pairs the server refused as `snapshot_mismatch`: asking again gets the same answer, so they
   * are never asked again while the app runs, and Sync can't help them. @type {Set<string>} */
  const mismatched = new Set();
  /** @param {string} dir */
  const attachOnce = async (dir) => {
    // The version, and so the render its files must produce, before any snapshot is looked at.
    const last = await versionOnPage(dir);
    if (!last || last.files) return;
    const snapshot = await forRender(dir, last.fingerprint);
    if (!snapshot) return;
    const pair = pairOf(last.versionId, snapshot);
    if (mismatched.has(pair)) return;
    try {
      await client.attachSnapshot(last.projectId, last.versionId, snapshot);
    } catch (error) {
      if (snapshotRefusal(error, "snapshot_mismatch")) mismatched.add(pair);
      if (!snapshotRefusal(error, "snapshot_already_attached")) throw error;
    }
    await markFiles(dir, last.versionId, last.projectId);
  };
  /** @param {string} dir @returns {Promise<void>} */
  const attach = (dir) => {
    const key = normalize(dir);
    const running = attaching.get(key);
    if (running) return running;
    const run = attachOnce(dir).finally(() => attaching.delete(key));
    attaching.set(key, run);
    return run;
  };
  return {
    /** Attaches the last sync to the version on the page when it can; anything else leaves it as it is. */
    attach,
    /** The files line, once any attach a sync made possible has gone in. @param {string} dir
     * @returns {Promise<FilesAnswer>} */
    state: async (dir) => {
      await attach(dir).catch((error) => {
        // expected: the line below reads what the server holds, so a failed attach shows as no files, with Sync now.
        console.error("[review] files not attached:", error);
      });
      const [facts, found] = await Promise.all([versionFacts(dir), match(dir)]);
      const answer = filesStateOf(facts, found);
      // `not_synced` offers Sync now, which can't attach a snapshot the server refused for this version.
      const refused =
        answer.at === "not_synced" &&
        found.at === "matches" &&
        facts.last !== null &&
        mismatched.has(pairOf(facts.last.versionId, found.snapshot));
      return refused ? { at: "off" } : answer;
    },
  };
}

/** @typedef {ReturnType<typeof reviewFiles>} ReviewFiles */

/** @param {unknown} error @param {string} reason */
const snapshotRefusal = (error, reason) => error instanceof ReviewFailed && error.reason === reason;
