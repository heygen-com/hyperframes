// @ts-check
// Changing a review link's space (decided 2026-10-13): a new link in the new space, the old one off.
// The record keeps the old project until the new one has the video; a file beside the record holds the change
// meanwhile, so the next read of the link finishes one a failure or a crash left half done.
import { firstReviewAudience } from "./reviewAudience.mjs";
import { createHash, randomUUID } from "node:crypto";
import { mkdirInside } from "./storage.mjs";
import { writeJsonAtomic } from "./storage.mjs";
import { ReviewFailed } from "./reviewClient.mjs";
import {
  applyFirstAudience,
  listSpaces,
  oneAtATime,
  projectLine,
  readReviewSwitch as readSwitch,
  readShare,
  rebindRecord,
  reviewRecord,
  reviewSentence,
  reviewSwitchPath,
  shown,
  takenDown,
} from "./reviewShare.mjs";
import { rm } from "./storage.mjs";

/** @typedef {import("./reviewClient.mjs").ReviewClient} ReviewClient
 * @typedef {import("./types/share.js").ReviewShare} ReviewShare */

/** `body`: the registration as sent, so a retry is exact; `revokeFailures`: failed turn-offs of the old link.
 * @typedef {{ id?: string, from: string, fromSpace?: string, spaceId: string, space: string, projectId: string | null,
 * opened?: boolean, paused?: boolean, audience?: import("./types/share.js").AccessMode | undefined, revokeFailures?:
 * number, body: import("./types/reviewWire.js").RegisterProjectRequest }} Switch */

/** Puts the newest export on `projectId`; `onUploaded` runs once the server has it. Answers the sentence when it did
 * not go up. @typedef {(projectId: string, onUploaded: () => Promise<void>) => Promise<string | null>} Upload */

/** Why the newest export cannot go up now, or null when it can. @typedef {() => Promise<"export_first" |
 * "version_running" | null>} CanUpload */

/** A refusal of a change of space, with the space's name and, for a failed upload, why it failed. */
class SwitchFailed extends ReviewFailed {
  /** @param {number} status @param {string} reason
   * @param {{ space?: string, from?: string, sentence?: string }} said */
  constructor(status, reason, { space = "", from = "", sentence = "" } = {}) {
    super(status, reason);
    this.space = space;
    this.from = from;
    this.sentence = sentence;
  }
}

const switchPath = reviewSwitchPath;

/** Starts a new journal; only ever called once no earlier one holds an old link on. @param {string} dir
 * @param {Switch} change */
async function startSwitch(dir, change) {
  await oneAtATime(dir, async () => {
    const record = await reviewRecord(dir);
    if (record?.removed) throw new ReviewFailed(410, "review_project_removed");
    if (record?.projectId !== change.from) throw new ReviewFailed(409, "switch_cancelled");
    await mkdirInside(dir, ".hyperframes");
    await writeJsonAtomic(switchPath(dir), change);
  });
}

/** Whether the journal on disk is still this change's: a stale step never rewrites or drops a newer one.
 * @param {string} dir @param {Switch} change */
const owns = async (dir, change) => {
  const saved = await readSwitch(dir);
  return (
    saved !== null &&
    saved.id === change.id &&
    saved.from === change.from &&
    saved.spaceId === change.spaceId &&
    saved.body.client_operation_id === change.body.client_operation_id
  );
};

/** A removed or superseded change cannot publish or replace the current record.
 * @param {string} dir @param {Switch} change */
async function assertCurrent(dir, change) {
  const record = await reviewRecord(dir);
  if (record?.removed) throw new ReviewFailed(410, "review_project_removed");
  if (
    !(await owns(dir, change)) ||
    !record ||
    (record.projectId !== change.from && record.projectId !== change.projectId)
  )
    throw new ReviewFailed(409, "switch_cancelled");
}

/** @param {string} dir @param {Switch} change */
async function writeSwitch(dir, change) {
  if (await owns(dir, change)) await writeJsonAtomic(switchPath(dir), change);
}

/** @param {string} dir @param {Switch} change */
async function advanceSwitch(dir, change) {
  await oneAtATime(dir, async () => {
    await assertCurrent(dir, change);
    await writeSwitch(dir, change);
  });
}

/** @param {string} dir @param {Switch} change */
async function dropSwitch(dir, change) {
  if (await owns(dir, change)) await rm(switchPath(dir), { force: true });
}

/** The same change asks with the same key: the studio project, the old project, the space and the title. The title
 * keeps a later round trip under a new name from replaying an earlier key with another body (operation_conflict).
 * @param {string} studioProjectId @param {string} spaceId @param {string} from @param {string} title */
export const switchOperationId = (studioProjectId, spaceId, from, title) =>
  `space-${createHash("sha256")
    .update(JSON.stringify([studioProjectId, spaceId, from, title]))
    .digest("hex")
    .slice(0, 48)}`;

/** Every step that touches a project's journal (a change, a read's cleanup or resume) runs one after another. Its own
 * line: a change waits inside it on the record's line, so sharing that one would wait on itself. */
const journal = projectLine();
const inTurn = journal.inTurn;

/** A read's own step only when nothing else holds the project: a read never waits on an upload, and the step that
 * holds it finishes the journal itself. @param {string} dir @param {() => Promise<void>} step */
const whenIdle = (dir, step) => (journal.busy(dir) ? Promise.resolve() : inTurn(dir, step));

/** A space this token can register into, by id; anything else is refused before any write.
 * @param {ReviewClient} client @param {string} spaceId */
async function targetSpace(client, spaceId) {
  const space = (await listSpaces(client)).find((s) => s.space_id === spaceId);
  if (!space?.can_create_review)
    throw new SwitchFailed(403, "space_forbidden", { space: space?.name ?? "" });
  return space;
}

/** Registration answers no retry fixes: the change is dropped and says why. */
const ENDS_A_CHANGE = new Set(["space_forbidden", "project_bound_to_other_owner", "same_project"]);

/** Registers the change's body in its space, once; a refusal there ends the change. So does an answer naming the
 * old project: going on would put the version back on it and then turn its link, the only one, off.
 * @param {ReviewClient} client @param {string} dir @param {Switch} change @returns {Promise<Switch>} */
async function registered(client, dir, change) {
  if (change.projectId) return change;
  try {
    const { project_id } = await client.register(change.body, change.spaceId);
    if (project_id === change.from) {
      console.error("[review] registration in another space answered the old project:", {
        request: { space: change.spaceId, body: change.body },
        answer: { project_id },
      });
      throw new SwitchFailed(409, "same_project", { space: change.space });
    }
    const next = { ...change, projectId: project_id };
    await advanceSwitch(dir, next);
    return next;
  } catch (error) {
    return registrationRefused(error, dir, change);
  }
}

/** @param {unknown} error @param {string} dir @param {Switch} change @returns {Promise<never>} */
async function registrationRefused(error, dir, change) {
  const reason = error instanceof ReviewFailed ? error.reason : "";
  if (reason === "review_project_limit_reached" || reason === "review_subscription_required") {
    await advanceSwitch(dir, { ...change, paused: true });
    throw error;
  }
  if (reason === "review_project_removed") {
    await dropSwitch(dir, change);
    throw error;
  }
  if (!ENDS_A_CHANGE.has(reason)) throw error;
  await dropSwitch(dir, change);
  throw new SwitchFailed(/** @type {ReviewFailed} */ (error).status, reason, {
    space: change.space,
    from: change.fromSpace ?? "",
  });
}

/** The new link on and open to its space, then the old one off; a failed turn-off stays in the file. A takedown of
 * the old review before the new link opened keeps the new one as it is: private, its link not turned on.
 * @param {ReviewClient} client @param {string} dir @param {Switch & { projectId: string }} change */
async function settle(client, dir, change) {
  return oneAtATime(dir, async () => {
    await assertCurrent(dir, change);
    let share = await readShare(client, change.projectId);
    let now = change;
    if (!now.opened) {
      if (!(await oldTakenDown(client, now)))
        share = await openNew(client, now.projectId, share, now.audience);
      await writeSwitch(dir, (now = { ...now, opened: true }));
    }
    await turnOffOld(client, dir, now);
    return shown(client, share);
  });
}

/** The new link on and open to its space. A takedown refuses both for good (409 moderation_hold), so the change
 * stops asking and still turns the old link off. @param {ReviewClient} client @param {string} id
 * @param {import("./types/reviewWire.js").ShareDTO} share @param {import("./types/share.js").AccessMode} [audience] */
async function openNew(client, id, share, audience) {
  if (takenDown(share)) return share;
  try {
    if (share.revoked)
      share = await client.linkOn(id, {
        expected_link_generation: share.link_generation,
        client_operation_id: randomUUID(),
      });
    return await applyFirstAudience(client, id, share, audience);
  } catch (error) {
    if (!(error instanceof ReviewFailed) || error.reason !== "moderation_hold") throw error;
    return readShare(client, id);
  }
}

/** Only a 204, or a 404 for a share the server no longer has, ends the cleanup. Anything else keeps it, a lost
 * permission (403) included: that proves nothing about the link, and the owner may need to act.
 * @param {ReviewClient} client @param {string} dir @param {Switch} change */
async function turnOffOld(client, dir, change) {
  try {
    await client.linkOff(change.from);
  } catch (error) {
    if (!(error instanceof ReviewFailed) || error.status !== 404) {
      console.error("[review] old link not turned off yet:", error);
      const failed =
        (change.revokeFailures ?? 0) +
        (error instanceof ReviewFailed && error.status === 403 ? 2 : 1);
      return writeSwitch(dir, { ...change, revokeFailures: failed });
    }
  }
  await dropSwitch(dir, change);
}

/** The switched change whose old link is still to turn off, or null. @param {string} dir */
async function cleanupOf(dir) {
  const change = await readSwitch(dir);
  if (!change?.projectId) return null;
  const at = (await reviewRecord(dir))?.projectId;
  return change.opened || at === change.projectId
    ? { ...change, projectId: change.projectId }
    : null;
}

/** Each read of the link turns off an old link a change left on, in turn with every other journal step.
 * @param {{ projectPath: string, client: ReviewClient }} request @returns {Promise<void>} */
export const retryOldLink = ({ projectPath, client }) =>
  whenIdle(projectPath, async () => {
    const change = await cleanupOf(projectPath);
    if (change) await settle(client, projectPath, change);
  });

/** What the popover says of an old link still on: where it is, and whether retries keep failing.
 * @param {string} projectPath @returns {Promise<ReviewShare["oldLink"]>} */
export async function oldLinkOf(projectPath) {
  const change = await cleanupOf(projectPath);
  if (!change) return null;
  return { space: change.fromSpace ?? "the old space", stuck: (change.revokeFailures ?? 0) >= 2 };
}

/** Registered: the video goes up to the new project, the record switches there once it has it, then `settle`.
 * @param {ReviewClient} client @param {string} dir @param {Switch} change @param {Upload} upload */
async function carryOn(client, dir, change, upload) {
  const at = await registered(client, dir, change);
  await oneAtATime(dir, () => assertCurrent(dir, at));
  await readShare(client, /** @type {string} */ (at.projectId)).catch(async (error) => {
    if (error instanceof ReviewFailed && error.reason === "review_project_removed")
      await dropSwitch(dir, at);
    throw error;
  });
  const projectId = /** @type {string} */ (at.projectId);
  let switched = false;
  const failure = await new Promise((done, failed) => {
    const onUploaded = async () => {
      await oneAtATime(dir, async () => {
        await assertCurrent(dir, at);
        await openNew(client, projectId, await readShare(client, projectId), at.audience);
        await writeSwitch(dir, { ...at, opened: true });
        await rebindRecord(dir, projectId, at.spaceId);
      });
      switched = true;
      done(null);
    };
    upload(projectId, onUploaded).then(done, failed);
  });
  if (!switched)
    throw new SwitchFailed(409, "switch_upload", {
      sentence: failure ?? "Couldn't add this version. Try again.",
    });
  return settle(client, dir, { ...at, projectId });
}

/** A change that switched but left its old link on finishes first; no new change starts while it stays on.
 * @param {ReviewClient} client @param {string} dir @param {Switch} saved */
async function oldLinkFirst(client, dir, saved) {
  await settle(client, dir, { ...saved, projectId: /** @type {string} */ (saved.projectId) });
  if (await readSwitch(dir))
    throw new SwitchFailed(409, "old_link_on", { space: saved.fromSpace ?? "" });
}

/** A change to `spaceId`, refused before anything is written when the space or the export cannot take it.
 * @param {{ client: ReviewClient, record: { studioProjectId: string, projectId: string | null }, title: string,
 * spaceId: string, now: import("./types/reviewWire.js").ShareDTO, canUpload: CanUpload, audience?:
 * import("./types/share.js").AccessMode | undefined }} request
 * @returns {Promise<Switch>} */
async function newChange({ client, record, title, spaceId, now, canUpload, audience }) {
  const space = await targetSpace(client, spaceId);
  const chosen = firstReviewAudience(space.review_entitlements, audience);
  const blocked = await canUpload();
  if (blocked) throw new SwitchFailed(409, blocked, { space: space.name });
  const from = /** @type {string} */ (record.projectId);
  const named = title.slice(0, 255);
  return {
    id: randomUUID(),
    audience: chosen,
    from,
    fromSpace: now.space?.name ?? "the old space",
    spaceId,
    space: space.name,
    projectId: null,
    body: {
      studio_project_id: record.studioProjectId,
      title: named,
      client_operation_id: switchOperationId(record.studioProjectId, spaceId, from, named),
    },
  };
}

/** @param {string} projectPath */
async function sharedRecord(projectPath) {
  const record = await reviewRecord(projectPath);
  if (record?.removed) throw new ReviewFailed(410, "review_project_removed");
  if (!record?.opened || !record.projectId) throw new ReviewFailed(404, "not_shared");
  return { ...record, projectId: record.projectId };
}

/** Moves a shared project's link to `spaceId`: a new link there, the newest export on it, the old link off. Its own
 * space answers the link as it is. Refuses before any write when the export cannot go up.
 * @param {{ projectPath: string, title: string, client: ReviewClient, spaceId: string, upload: Upload,
 * canUpload: CanUpload, audience?: import("./types/share.js").AccessMode | undefined }} request @returns
 * {Promise<ReviewShare>} */
export const changeSpace = ({ projectPath, title, client, spaceId, upload, canUpload, audience }) =>
  inTurn(projectPath, async () => {
    const record = await sharedRecord(projectPath);
    const from = record.projectId;
    const saved = await readSwitch(projectPath);
    if (saved?.projectId === from) await oldLinkFirst(client, projectPath, saved);
    // A change already registered there carries on; one never registered is made again, with the same key.
    if (saved?.from === from && saved.spaceId === spaceId) {
      if (await droppedForTakedown(client, projectPath, saved))
        throw new ReviewFailed(409, "moderation_hold");
      const target = await targetSpace(client, spaceId);
      const retry = {
        ...saved,
        audience: firstReviewAudience(target.review_entitlements, audience),
        paused: false,
      };
      await advanceSwitch(projectPath, retry);
      return carryOn(client, projectPath, retry, upload);
    }
    const now = await readShare(client, from);
    if (sameSpace(now, record.spaceId, spaceId)) return shown(client, now);
    if (takenDown(now)) throw new ReviewFailed(409, "moderation_hold");
    const change = await newChange({ client, record, title, spaceId, now, canUpload, audience });
    await startSwitch(projectPath, change);
    return carryOn(client, projectPath, change, upload);
  });

/** On the next read of the link: finishes the upload of a change a crash or a failure left half done (the old link's
 * turn-off is `retryOldLink`'s). One never switched that the record has moved past is dropped: no link of it is on.
 * @param {{ projectPath: string, client: ReviewClient, upload: Upload, canUpload: CanUpload }} request */
export const resumeSpaceChange = async ({ projectPath, client, upload, canUpload }) => {
  // An old link still on is retryOldLink's: holding the journal only to see that would make the next read skip it.
  if (await cleanupOf(projectPath)) return;
  return whenIdle(projectPath, async () => {
    const change = await readSwitch(projectPath);
    if (!change || change.paused || (await cleanupOf(projectPath))) return;
    const at = (await reviewRecord(projectPath))?.projectId;
    if (at !== change.from) return dropSwitch(projectPath, change);
    if (await droppedForTakedown(client, projectPath, change)) return;
    if (!(await canUpload())) await carryOn(client, projectPath, change, upload);
  });
};

/** A saved change whose old review staff took down is dropped before it registers, uploads or opens anything: the
 * server takes all three under a takedown, so finishing it would share the review again. A failed read is no
 * takedown and the change goes on as it did. @param {ReviewClient} client @param {string} dir @param {Switch} change */
async function droppedForTakedown(client, dir, change) {
  try {
    if (!(await oldTakenDown(client, change))) return false;
  } catch (error) {
    if (error instanceof ReviewFailed && error.reason === "review_project_removed")
      await dropSwitch(dir, change);
    throw error;
  }
  await dropSwitch(dir, change);
  return true;
}

/** Whether staff took the change's old review down; a failed read says no.
 * @param {ReviewClient} client @param {Switch} change */
async function oldTakenDown(client, change) {
  const old = await readShare(client, change.from).catch((error) => {
    if (error instanceof ReviewFailed && error.reason === "review_project_removed") throw error;
    return null;
  });
  return Boolean(old && takenDown(old));
}

/** The sentence for a failed change of space; any other failure reads as the share's, or as `fallback`.
 * @param {unknown} error @param {string} [fallback] */
export function switchSentence(error, fallback) {
  if (!(error instanceof SwitchFailed)) return reviewSentence(error, fallback);
  const space = error.space || "that space";
  if (error.reason === "space_forbidden") return `You can't share to ${space} with this account.`;
  if (error.reason === "project_bound_to_other_owner")
    return `Someone else already shares this project in ${space}.`;
  if (error.reason === "export_first")
    return `Export an MP4 of the project as it is now, then share it to ${space}.`;
  if (error.reason === "old_link_on")
    return "Couldn’t move the link. Your current link still works.";
  if (error.reason === "same_project")
    return `HyperFrames kept this link in ${error.from || "its space"} instead of moving it to ${space}. The old link still works.`;
  if (error.reason === "version_running")
    return "A version is still going up. Change the space once it's on the page.";
  return `${error.sentence} The old link still works.`;
}

/** @param {import("./types/reviewWire.js").ShareDTO} share @param {string | null} saved @param {string} target */
const sameSpace = (share, saved, target) => (share.space?.space_id ?? saved) === target;
