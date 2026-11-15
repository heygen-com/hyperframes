// @ts-check
// Share for review: the project's review link. Its local id lives in .hyperframes/review.json;
// copies skip .hyperframes, so a duplicate gets its own link, as the backend wants of a fork.
import { withProjectShareLock } from "./projectLock.mjs";
import { firstReviewAudience } from "./reviewAudience.mjs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdirInside } from "./storage.mjs";
import {
  isJsonObject,
  isNullableSavedId,
  isOptionalBoolean,
  isOptionalSavedId,
  isSavedId,
  readJsonRecord,
  SharingStateError,
  writeJsonAtomic,
} from "./storage.mjs";
import { channelSite, normalize, signinSites } from "./host.mjs";
import { ReviewFailed } from "./reviewClient.mjs";
import { rename } from "./storage.mjs";

/** @typedef {import("./reviewClient.mjs").ReviewClient} ReviewClient
 * @typedef {import("./types/reviewWire.js").ShareDTO} ShareDTO */

/** @typedef {import("./types/share.js").ReviewShare} ReviewShare
 * @typedef {import("./types/share.js").ReviewSpace} ReviewSpace
 * @typedef {import("./types/share.js").ReviewAccessChange} ReviewAccessChange */

/** Persist studioProjectId/spaceId before sending so a lost reply retries the same project and space; projectId after.
 * opened marks the first completed share; site/ownerEmail bind the record to its backend/account.
 * @typedef {{ studioProjectId: string, spaceId: string|null, projectId: string|null, opened: boolean,
 * site: string, ownerEmail: string|null, removed?: boolean, registration?:
 * import("./types/reviewWire.js").RegisterProjectRequest | undefined }} ReviewRecord */

/** The sign-in site this run's review calls go to, the channel's own until then.
 * Ids from another site's server mean nothing here, so each site keeps its own record and never reads another's.
 * @type {string | null} */
let chosenSite = null;
const site = () => chosenSite ?? channelSite();
/** @param {string} now */
export const setReviewSite = (now) => {
  chosenSite = now;
};

/** The channel's own site keeps the original review.json; any other site its own file.
 * @param {string} projectPath @param {string} [at] */
const recordPath = (projectPath, at = site()) =>
  path.join(
    projectPath,
    ".hyperframes",
    at === channelSite() ? "review.json" : `review-${new URL(at).host}.json`,
  );

/** The review metadata path for the current sign-in site. @param {string} projectPath */
export const reviewRecordPath = (projectPath) => recordPath(projectPath);

/** @param {unknown} value @returns {value is import("./types/reviewWire.js").RegisterProjectRequest} */
function isRegistration(value) {
  return (
    isJsonObject(value) &&
    isSavedId(value.studio_project_id) &&
    isSavedId(value.client_operation_id) &&
    typeof value.title === "string"
  );
}

/** @typedef {{ studioProjectId: string } &
 * Partial<Pick<ReviewRecord, "spaceId" | "projectId" | "opened" | "removed">>} SavedIdentity */

/** @param {Record<string, unknown>} record @returns {record is Record<string, unknown> & SavedIdentity} */
const isSavedIdentity = (record) =>
  isSavedId(record.studioProjectId) &&
  isOptionalSavedId(record.spaceId) &&
  isOptionalSavedId(record.projectId) &&
  isOptionalBoolean(record.opened) &&
  isOptionalBoolean(record.removed) &&
  (!record.opened || isSavedId(record.projectId));

/** @param {unknown} value @param {string} studioProjectId @param {string} file */
function savedRegistration(value, studioProjectId, file) {
  if (value == null) return undefined;
  if (!isRegistration(value) || value.studio_project_id !== studioProjectId)
    throw new SharingStateError(file);
  return value;
}

/** @param {string} projectPath @param {string} [at] @returns {Promise<ReviewRecord | null>} */
async function readRecord(projectPath, at = site()) {
  const file = recordPath(projectPath, at);
  const record = await readJsonRecord(file);
  if (!record) return null;
  const { site: madeOn = channelSite() } = record;
  if (madeOn !== at || !isSavedIdentity(record)) throw new SharingStateError(file);
  return {
    studioProjectId: record.studioProjectId,
    spaceId: record.spaceId ?? null,
    projectId: record.projectId ?? null,
    opened: record.opened === true,
    removed: record.removed === true,
    registration: savedRegistration(record.registration, record.studioProjectId, file),
    site: madeOn,
    ownerEmail: typeof record.ownerEmail === "string" ? record.ownerEmail : null,
  };
}

/** Production, or Dev for any other site. @param {string} at */
const backendName = (at) => (at === channelSite() ? "Production" : "Dev");

/** Not shared here, but shared on another backend: say where, so the person can switch or share again here.
 * @param {string} projectPath @returns {Promise<ReviewFailed | null>} */
async function sharedElsewhere(projectPath) {
  for (const other of signinSites()) {
    const record = other === site() ? null : await readRecord(projectPath, other);
    if (record?.opened && record.projectId)
      return new ReviewFailed(409, `other_backend:${backendName(other)}`);
  }
  return null;
}

/** A space as the wire names it; `has_other_members` only when the server says.
 * @param {NonNullable<ShareDTO["space"]> | import("./types/reviewWire.js").SpaceDTO} space */
const spaceRefOf = (space) => ({
  id: space.space_id,
  name: space.name,
  kind: space.kind,
  ...(typeof space.has_other_members === "boolean" && { hasOtherMembers: space.has_other_members }),
});

/** @param {ShareDTO} share @returns {ReviewShare} */
const statusOf = (share) => ({
  projectId: share.project_id,
  url: share.revoked ? null : share.review_url,
  access: share.access_mode,
  role: share.default_role,
  commentsOn: share.comments_enabled,
  space: share.space ? spaceRefOf(share.space) : null,
  elsewhere: false,
  entitlements: share.review_entitlements,
  ...(share.sharing_state && { sharingState: share.sharing_state }),
  held: share.moderation_hold === true,
  ...(takenDown(share) && { takedown: { page: share.authenticated_review_url } }),
});

/** A staff takedown: the server refuses a new link and any audience but private until staff lift it.
 * @param {ShareDTO} share */
export const takenDown = (share) => share.moderation_hold_kind === "takedown";

/** The account's spaces as the server lists them; a server without the route answers 404: none.
 * @param {ReviewClient} client */
export const listSpaces = (client) =>
  client.spaces().catch((error) => {
    if (error instanceof ReviewFailed && error.status === 404) return [];
    throw error;
  });

/** The workspace Desktop is signed into, where every new link goes: its token is bound there and ignores any other
 * space. The server marks it `bound`; a server that does not yet marks the one space it lets this token create in, else none.
 * @param {import("./types/reviewWire.js").SpaceDTO[]} spaces */
function signedInSpace(spaces) {
  const creatable = spaces.filter((space) => space.can_create_review);
  return spaces.find((space) => space.bound) ?? (creatable.length === 1 ? creatable[0] : null);
}

/** Every space the account is in, the signed-in one marked: the later workspace switch lists them; v1 names one.
 * @param {{ client: ReviewClient }} request @returns {Promise<ReviewSpace[]>} */
export async function reviewSpaces({ client }) {
  const spaces = await listSpaces(client);
  const here = signedInSpace(spaces);
  return spaces.map((space) => ({
    ...spaceRefOf(space),
    lastUsedAt: space.last_used_at,
    canCreate: space.can_create_review,
    signedIn: space === here,
    entitlements: space.review_entitlements,
  }));
}

/** The share as the person sees it: owner routes do not hold a token to its workspace, so a page in another one
 * than Desktop is signed into works as any other, and is only named (`elsewhere`). A failed list names nothing.
 * @param {ReviewClient} client @param {ShareDTO} share @returns {Promise<ReviewShare>} */
export async function shown(client, share) {
  const bound = (await listSpaces(client).catch(() => [])).find((space) => space.bound);
  const elsewhere = Boolean(bound && share.space && share.space.space_id !== bound.space_id);
  return { ...statusOf(share), elsewhere };
}

/** An owner route's refusal for a project this app shared: 403 permission_denied is an owner who left its workspace,
 * a workspace deleted, or Desktop signed into another account (named, when the record knows whose it is); 404 is a
 * project another account shares now, or the server no longer has.
 * @param {ReviewClient} client @param {string} [projectPath] */
const ownerRefusal = (client, projectPath) => async (/** @type {unknown} */ error) => {
  if (!(error instanceof ReviewFailed)) throw error;
  if (error.reason === "permission_denied") {
    const [record, now] = await Promise.all([
      projectPath ? readRecord(projectPath) : null,
      client.signedInEmail(),
    ]);
    const owner = record?.ownerEmail;
    const other = owner && now && owner.toLowerCase() !== now.toLowerCase();
    throw new ReviewFailed(403, other ? OWNER_SIGNED_OUT + owner : "no_access");
  }
  throw error.status === 404 ? new ReviewFailed(404, "another_account") : error;
};

const OWNER_SIGNED_OUT = "owner_signed_out:";
/** The email in an owner_signed_out reason, else null. @param {string} reason */
export const ownerOf = (reason) =>
  reason.startsWith(OWNER_SIGNED_OUT) ? reason.slice(OWNER_SIGNED_OUT.length) : null;

/** A line per project: each step runs once the one before it settled; `busy` while one runs or waits. */
export function projectLine() {
  /** @type {Map<string, Promise<unknown>>} */
  const queues = new Map();
  /** @template T @param {string} projectPath @param {() => Promise<T>} run @returns {Promise<T>} */
  const inTurn = (projectPath, run) => {
    const key = normalize(projectPath);
    const next = (queues.get(key) ?? Promise.resolve()).then(run, run);
    const settled = next.catch(() => {});
    queues.set(key, settled);
    void settled.then(() => queues.get(key) === settled && queues.delete(key));
    return next;
  };
  return {
    inTurn,
    busy: (/** @type {string} */ projectPath) => queues.has(normalize(projectPath)),
  };
}

/** One change per project at a time, so two presses never register twice or race a revision. */
const metadataLine = projectLine().inTurn;
/** @template T @param {string} projectPath @param {() => Promise<T>} run */
export const oneAtATime = (projectPath, run) =>
  metadataLine(projectPath, () => withProjectShareLock(projectPath, "review", run));

/** Applies the person's choice over whatever else the share holds; a stale revision is read again once.
 * @param {ReviewClient} client @param {string} id @param {ShareDTO} share
 * @param {Partial<Pick<ShareDTO, "access_mode" | "default_role">>} change @returns {Promise<ShareDTO>} */
export async function changeShare(client, id, share, change) {
  for (let read = share, retried = false; ; retried = true) {
    const body = {
      access_mode: read.access_mode,
      default_role: read.default_role,
      comments_enabled: read.comments_enabled,
      ...change,
      expected_revision: read.revision,
    };
    // Only the workspace's audience may default to Can edit: leaving it hands the new audience Can comment.
    if (body.access_mode !== "team" && body.default_role === "editor")
      body.default_role = "commenter";
    try {
      return await client.updateShare(id, body);
    } catch (error) {
      const stale = error instanceof ReviewFailed && error.reason === "revision_conflict";
      if (retried || !stale) throw error;
      read = await client.share(id);
    }
  }
}

/** @param {string} projectPath @param {ReviewClient} _client */
async function sharedId(projectPath, _client) {
  const record = await readRecord(projectPath);
  if (record?.removed) throw new ReviewFailed(410, "review_project_removed");
  if (!record?.opened || !record.projectId)
    throw (await sharedElsewhere(projectPath)) ?? new ReviewFailed(404, "not_shared");
  return record.projectId;
}

/** The server's id for a project this app finished sharing, else null; the comment feed reads it.
 * @param {string} projectPath @returns {Promise<string | null>} */
export async function reviewProjectId(projectPath) {
  const record = await readRecord(projectPath);
  return !record?.removed && record?.opened && record.projectId ? record.projectId : null;
}

/** Which local project each review project was shared from: review project id to its folder.
 * @param {string[]} paths @returns {Promise<Record<string, string>>} */
export async function localReviewProjects(paths) {
  const pairs = await Promise.all(paths.map(async (dir) => [await reviewProjectId(dir), dir]));
  return Object.fromEntries(pairs.filter(([id]) => id));
}

/** The record's ids, for a change of space. @param {string} projectPath */
export const reviewRecord = (projectPath) => readRecord(projectPath);

/** Where a change of space waits: beside this backend's record, so one backend never finishes or drops another's.
 * @param {string} projectPath */
export const reviewSwitchPath = (projectPath) =>
  recordPath(projectPath).replace(/\.json$/, ".switch.json");

/** @param {string} dir @returns {Promise<import("./reviewSwitch.mjs").Switch | null>} */
export async function readReviewSwitch(dir) {
  const file = reviewSwitchPath(dir);
  const change = await readJsonRecord(file);
  if (!change) return null;
  if (
    !isSavedId(change.from) ||
    !isSavedId(change.spaceId) ||
    typeof change.space !== "string" ||
    !isNullableSavedId(change.projectId) ||
    (change.id !== undefined && !isSavedId(change.id)) ||
    !isOptionalBoolean(change.opened) ||
    !isOptionalBoolean(change.paused) ||
    (change.opened && !isSavedId(change.projectId)) ||
    !isRegistration(change.body)
  ) {
    throw new SharingStateError(file);
  }
  return /** @type {import("./reviewSwitch.mjs").Switch} */ (change);
}

/** @type {Set<(projectPath: string) => void>} */
const rebound = new Set();
/** Called with a project's normalized path once its record names another review project.
 * @param {(projectPath: string) => void} listener */
export const onRebound = (listener) => void rebound.add(listener);

/** Tells every listener that a project's record names another review project now. @param {string} projectPath */
const announceRebound = (projectPath) => {
  for (const listener of rebound) listener(normalize(projectPath));
};

/** Points the record at another review project, keeping every other field the record holds.
 * @param {string} projectPath @param {string} projectId @param {string} spaceId */
export async function rebindRecord(projectPath, projectId, spaceId) {
  const record = await readRecord(projectPath);
  if (!record) throw new ReviewFailed(404, "not_shared");
  if (record.removed) throw new ReviewFailed(410, "review_project_removed");
  await writeJsonAtomic(recordPath(projectPath), { ...record, projectId, spaceId, opened: true });
  announceRebound(projectPath);
}

/** Puts a project's record aside, so the next share registers it anew from the signed-in account: a new id and a new
 * link. The old record stays beside it as review.previous-<time>.json, and its link and comments with its account.
 * @param {string} projectPath */
export const setAsideReview = (projectPath) =>
  oneAtATime(projectPath, async () => {
    const at = recordPath(projectPath);
    if (await readRecord(projectPath))
      await rename(at, at.replace(/\.json$/, `.previous-${Date.now()}.json`));
  });

/** Shares a project anew from the signed-in account: its record set aside, then `share` makes the new link, and the
 * feed in view follows to the new page.
 * @template T @param {string} projectPath @param {() => Promise<T>} share @returns {Promise<T>} */
export async function shareAnew(projectPath, share) {
  await setAsideReview(projectPath);
  const made = await share();
  announceRebound(projectPath);
  return made;
}

/** The share as the server holds it; `projectPath` lets a refusal name the account that shared it.
 * @param {ReviewClient} client @param {string} id @param {string} [projectPath] */
export const readShare = (client, id, projectPath) =>
  client.share(id).catch(ownerRefusal(client, projectPath));

/** The link as the server holds it now; null until the first share finished.
 * @param {{ projectPath: string, client: ReviewClient }} request @returns {Promise<ReviewShare | null>} */
export async function reviewStatus({ projectPath, client }) {
  const record = await readRecord(projectPath);
  if (record?.removed) throw new ReviewFailed(410, "review_project_removed");
  if (!record?.opened || !record.projectId) {
    const held = await takenDownFirst(client, record);
    if (held) return held;
    const elsewhere = await sharedElsewhere(projectPath);
    if (elsewhere) throw elsewhere;
    return null;
  }
  try {
    return shown(client, await readShare(client, record.projectId, projectPath));
  } catch (error) {
    if (error instanceof ReviewFailed && error.reason === "review_project_removed")
      await markReviewRemoved(projectPath, record.projectId);
    throw error;
  }
}

/** A first share staff took down before it finished: registered, never opened, and the read still says so. Only that
 * record reads the share; a failed read says nothing.
 * @param {ReviewClient} client @param {ReviewRecord | null} record */
async function takenDownFirst(client, record) {
  if (!record?.projectId) return null;
  const share = await readShare(client, record.projectId).catch((error) => {
    if (error instanceof ReviewFailed && error.reason === "review_project_removed") throw error;
    return null;
  });
  return share && takenDown(share) ? shown(client, share) : null;
}

/** The project's record for a share press, written before any request. v1 passes no space: a new link goes to the
 * signed-in workspace. A recorded space is kept until the server registered or refused it, so a retry after a lost
 * reply never leaves a second project behind. A registered project keeps its space, whichever is signed in.
 * @param {ReviewClient} client @param {string} projectPath @param {string | null} spaceId */
async function recordToShare(client, projectPath, spaceId) {
  const record = await readRecord(projectPath);
  if (record?.removed) throw new ReviewFailed(410, "review_project_removed");
  if (record?.projectId) return record;
  const space = await registrationSpace(client, spaceId, record);
  if (record && space === record.spaceId) return record;
  const fresh = {
    studioProjectId: record?.studioProjectId ?? randomUUID(),
    spaceId: space,
    projectId: null,
    opened: false,
    site: site(),
    ownerEmail: null,
  };
  await mkdirInside(projectPath, ".hyperframes");
  await writeJsonAtomic(recordPath(projectPath), fresh);
  return fresh;
}

/** @param {ReviewClient} client @param {string | null} requested @param {ReviewRecord | null} record */
async function registrationSpace(client, requested, record) {
  return requested ?? record?.spaceId ?? signedInSpace(await listSpaces(client))?.space_id ?? null;
}

/** Registers the recorded project in its space. A refused space is forgotten, so the next press asks again.
 * @param {ReviewClient} client @param {string} projectPath @param {ReviewRecord} record @param {string} title */
async function registerOnce(client, projectPath, record, title) {
  const body = record.registration ?? {
    studio_project_id: record.studioProjectId,
    title: title.slice(0, 255),
    client_operation_id: randomUUID(),
  };
  await writeJsonAtomic(recordPath(projectPath), { ...record, registration: body });
  try {
    return (await client.register(body, record.spaceId)).project_id;
  } catch (error) {
    if (!(error instanceof ReviewFailed) || error.reason !== "space_forbidden") throw error;
    await writeJsonAtomic(recordPath(projectPath), { ...record, spaceId: null });
    throw await spaceRefusal(client, record.spaceId, error);
  }
}

/** A space refused at registration. Only one picked before the workspace changed is replaced by the next press;
 * otherwise (the signed-in workspace, the default, or a list that cannot say) another press would loop.
 * @param {ReviewClient} client @param {string | null} refused @param {ReviewFailed} error */
async function spaceRefusal(client, refused, error) {
  const here = signedInSpace(await listSpaces(client).catch(() => []));
  const changed = Boolean(refused && here && here.space_id !== refused);
  return changed ? error : new ReviewFailed(403, "workspace_cannot_share");
}

/** Share's press: the first registers the project into the space given (none: the signed-in one) and opens its link
 * to that space; a later one reads the link, turning it back on when it was off. A registered project keeps its space.
 * A host can prepare review content after registration is saved and before the link or its audience changes.
 * @param {{ projectPath: string, title: string, client: ReviewClient, spaceId?: string | null, audience?:
 * import("./types/share.js").AccessMode | undefined, beforeOpen?: (projectId: string) => Promise<void> }} request */
export const shareForReview = ({
  projectPath,
  title,
  client,
  spaceId = null,
  audience,
  beforeOpen,
}) =>
  oneAtATime(projectPath, async () => {
    const read = await recordToShare(client, projectPath, spaceId);
    const id = read.projectId ?? (await registerOnce(client, projectPath, read, title));
    const record = read.projectId
      ? read
      : { ...read, projectId: id, ownerEmail: await client.signedInEmail() };
    if (!read.projectId) await writeJsonAtomic(recordPath(projectPath), record);
    const share = await readShare(client, id, projectPath);
    if (takenDown(share)) return shown(client, share);
    if (!record.opened || share.revoked) await beforeOpen?.(id);
    return openLink(client, projectPath, record, id, share, audience).then(
      (opened) => shown(client, opened),
      heldInstead(client, id),
    );
  });

/** Turns a link that was off back on, and opens a first share to the workspace.
 * @param {ReviewClient} client @param {string} projectPath @param {ReviewRecord} record @param {string} id
 * @param {ShareDTO} share @param {import("./types/share.js").AccessMode} [audience] */
async function openLink(client, projectPath, record, id, share, audience) {
  // Back on means a new address: the server never revives a turned-off link.
  if (share.revoked)
    share = await client.linkOn(id, {
      expected_link_generation: share.link_generation,
      client_operation_id: randomUUID(),
    });
  // A lost PATCH reply leaves the first share incomplete; a fresh explicit choice must still apply.
  if (!record.opened) {
    share = await applyFirstAudience(client, id, share, audience);
    await writeJsonAtomic(recordPath(projectPath), { ...record, projectId: id, opened: true });
  }
  return share;
}

/** @param {ReviewClient} client @param {string} id @param {ShareDTO} share
 * @param {import("./types/share.js").AccessMode} [audience] */
export async function applyFirstAudience(client, id, share, audience) {
  const chosen =
    audience !== undefined || share.access_mode === "private"
      ? firstReviewAudience(share.review_entitlements, audience)
      : share.access_mode;
  if (share.access_mode !== chosen)
    share = await changeShare(client, id, share, { access_mode: chosen });
  return share;
}

/** A takedown that landed after the read refuses the link with 409 moderation_hold; retrying never helps, so the
 * press answers the held state instead. @param {ReviewClient} client @param {string} id */
const heldInstead = (client, id) => async (/** @type {unknown} */ error) => {
  if (!(error instanceof ReviewFailed) || error.reason !== "moderation_hold") throw error;
  return shown(client, await readShare(client, id));
};

/** Who can open the link, or whether they can comment: only what the person picked is sent, over the share as the
 * server holds it now, so a change made on the page is never put back.
 * @param {{ projectPath: string, client: ReviewClient, change: ReviewAccessChange }} request
 * @returns {Promise<ReviewShare>} */
export const setReviewAccess = ({ projectPath, client, change }) =>
  oneAtATime(projectPath, async () => {
    const id = await sharedId(projectPath, client);
    const share = await readShare(client, id, projectPath);
    const picked =
      "access" in change ? { access_mode: change.access } : { default_role: change.role };
    return shown(client, await changeShare(client, id, share, picked));
  });

/** Turns the link off for everyone; comments and settings are kept, and the next share makes a new link.
 * @param {{ projectPath: string, client: ReviewClient }} request @returns {Promise<ReviewShare>} */
export const turnOffReviewLink = ({ projectPath, client }) =>
  oneAtATime(projectPath, async () => {
    const id = await sharedId(projectPath, client);
    await client.linkOff(id).catch(ownerRefusal(client, projectPath));
    return shown(client, await readShare(client, id, projectPath));
  });

/** A refusal's sentence by its reason alone. */
const SENTENCES = {
  review_project_limit_reached:
    "This workspace has used its five review projects. Remove a review project or upgrade HyperFrames to create more.",
  review_subscription_required: "Restricted sharing requires a HyperFrames subscription.",
  review_public_consent_required: "Choose Share with anyone who has the link to continue.",
  review_entitlement_unavailable: "Couldn't confirm sharing availability. Try again.",
  review_project_changed: "This project’s review changed. Reopen sharing and try again.",
  review_project_removed:
    "This review project was removed. Share again to create a new link and discussion.",
  moderation_hold: "This review was taken down for a policy violation, so it can't be shared.",
  not_public: "Only a link anyone can open has a guest view. Open the review page instead.",
  another_account:
    "This link was made by another HeyGen account, or was deleted. Sign in with the account that shared it.",
  no_access:
    "This account can't open this project's review page. Sign in with the account that shared it, or ask to be added back to its workspace.",
  workspace_cannot_share: "This workspace can't create review pages.",
  space_forbidden: "Your workspace changed. Share again to use the workspace you're signed into.",
  project_bound_to_other_owner:
    "Someone else in your workspace already shares this project. Duplicate it to share your own copy.",
  feature_unavailable: "Review pages aren't available for your account yet.",
};

/** The one sentence a person reads for a failed call; the log keeps the status and reason. `fallback` names the
 * call when the reason has no sentence of its own.
 * @param {unknown} error @param {string} [fallback] */
export function reviewSentence(error, fallback = "Couldn't share this project. Try again.") {
  if (error instanceof SharingStateError) return error.message;
  if (!(error instanceof ReviewFailed)) return fallback;
  if (error.status === 0) return "Couldn't reach HeyGen. Check your connection and try again.";
  if (error.status === 401) return "Your sign-in has expired. Sign in again, then share.";
  if (error.reason.startsWith("other_backend:")) {
    const name = error.reason.slice("other_backend:".length);
    return `This review was shared on ${name}. Switch to ${name} to open it, or share again here.`;
  }
  const owner = ownerOf(error.reason);
  if (owner) return `This review belongs to ${owner}. Switch to that account to manage it.`;
  if (Object.hasOwn(SENTENCES, error.reason))
    return SENTENCES[/** @type {keyof typeof SENTENCES} */ (error.reason)];
  if (error.status === 403) return "This account can't share this project for review yet.";
  if (error.status === 429 || error.status === 503)
    return "Sharing is busy right now. Try again in a moment.";
  return fallback;
}

/** @param {string} projectPath @param {string} projectId */
export const markReviewRemoved = (projectPath, projectId) =>
  oneAtATime(projectPath, () => retainRemovedRecord(projectPath, projectId));

/** @param {string} projectPath @param {string} projectId @param {ReviewClient} client */
export const removeLocalReview = (projectPath, projectId, client) =>
  removeReviewProject(projectId, client, [projectPath]);

/** Locks each open binding involved in this removal before sending DELETE, including a move's source.
 * @param {string} projectId @param {ReviewClient} client @param {string[]} projectPaths */
export async function removeReviewProject(projectId, client, projectPaths) {
  /** @type {string[]} */
  const affected = [];
  for (const dir of [...new Set(projectPaths.map(normalize))].sort()) {
    const record = await readRecord(dir);
    const change = await readReviewSwitch(dir);
    if (
      record?.projectId === projectId ||
      change?.from === projectId ||
      change?.projectId === projectId
    )
      affected.push(dir);
  }
  /** @param {number} index @returns {Promise<void>} */
  const locked = async (index) => {
    const dir = affected[index];
    if (dir) return oneAtATime(dir, () => locked(index + 1));
    await client.removeProject(projectId);
    for (const path of affected) await retainRemovedRecord(path, projectId);
  };
  await locked(0);
}

/** @param {string} projectPath @param {string} projectId */
async function retainRemovedRecord(projectPath, projectId) {
  const record = await readRecord(projectPath);
  const journal = await readReviewSwitch(projectPath);
  if (journal?.from === projectId || journal?.projectId === projectId)
    await rename(
      reviewSwitchPath(projectPath),
      reviewSwitchPath(projectPath).replace(/\.json$/, `.removed-${Date.now()}.json`),
    );
  if (record?.projectId !== projectId) return;
  await writeJsonAtomic(recordPath(projectPath), { ...record, removed: true });
  announceRebound(projectPath);
}

/** The owner workspace of an unfinished binding takes precedence over the active workspace.
 * @param {{client: ReviewClient, projectPath: string}} request @returns {Promise<ReviewSpace | null>} */
export async function reviewDestination({ client, projectPath }) {
  const record = await readRecord(projectPath);
  if (record?.removed) throw new ReviewFailed(410, "review_project_removed");
  if (record?.projectId) {
    const share = await readShare(client, record.projectId, projectPath);
    if (!share.space) return null;
    return {
      ...spaceRefOf(share.space),
      entitlements: share.review_entitlements,
      existingProjectId: record.projectId,
      resumingRegistration: true,
      ...(share.sharing_state && { sharingState: share.sharing_state }),
      signedIn: false,
      lastUsedAt: null,
      canCreate: true,
    };
  }
  const spaces = await reviewSpaces({ client });
  const destination =
    (record?.spaceId
      ? spaces.find((space) => space.id === record.spaceId)
      : spaces.find((space) => space.signedIn)) ?? null;
  return destination
    ? { ...destination, resumingRegistration: Boolean(record?.registration) }
    : null;
}
