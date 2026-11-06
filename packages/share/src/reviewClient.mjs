// @ts-check
// Review requests run on the host so the browser never receives the account bearer.

import { randomUUID } from "node:crypto";
import { rejectedGrantRequest } from "./grantRefusal.mjs";
import { signedInRequest } from "./host.mjs";
import { shareOpenCalls } from "./reviewOpenCalls.mjs";

/** @typedef {import("./types/reviewWire.js").ShareDTO} ShareDTO @typedef {import("./types/reviewWire.js").ProjectDTO} ProjectDTO
 * @typedef {import("./types/reviewWire.js").ExportDTO} ExportDTO */

const TIMEOUT_MS = 30_000;
const PROJECTS = "/v1/hyperframes/review-projects";
const SPACES = "/v1/hyperframes/review-spaces";

/** A refused or failed call: the HTTP status (0 when the server was never reached) and the server's reason. */
export class ReviewFailed extends Error {
  /** @param {number} status @param {string} reason @param {number} [currentRevision] @param {number} [retryAfterMs]
   * @param {import("./types/reviewWire.js").ErrorEnvelope["data"]} [details] */
  constructor(status, reason, currentRevision, retryAfterMs, details) {
    super(`review ${status} ${reason}`);
    this.status = status;
    this.reason = reason;
    this.currentRevision = currentRevision;
    this.retryAfterMs = retryAfterMs;
    this.details = details;
  }
}

/** The answer's data; null for a 204. A refusal throws with the server's status and reason.
 * @param {Response} reply @param {string} what @returns {Promise<any>} */
async function dataOf(reply, what) {
  if (reply.status === 204) return null;
  const payload = await reply.json().catch(() => null);
  if (reply.ok) return payload?.data ?? null;
  /** @type {import("./types/reviewWire.js").ErrorEnvelope["data"] | undefined} */
  const data = payload?.data;
  throw responseFailure(reply, what, data);
}

/** @param {Response} reply @param {string} what @param {import("./types/reviewWire.js").ErrorEnvelope["data"] | undefined} data */
function responseFailure(reply, what, data) {
  console.error(`[review] ${what} refused:`, reply.status, data?.reason);
  const retryAfter = Number(reply.headers.get("retry-after") ?? NaN);
  return new ReviewFailed(
    reply.status,
    data?.reason ?? "",
    data?.current_revision,
    retryAfter >= 0 ? retryAfter * 1000 : undefined,
    data,
  );
}

/** The server's own "no" to the sharing read: signed out, not allowed, or no such route. */
export const SHARING_REFUSALS = [401, 403, 404];

/** @param {{ access: import("./types/access.js").ApiAccess, fetchImpl?: typeof fetch,
 *   signedInEmail?: () => Promise<string | null> }} deps */
export function reviewClient({ access, fetchImpl = fetch, signedInEmail = async () => null }) {
  const request = signedInRequest({
    access,
    fetchImpl,
    timeoutMs: TIMEOUT_MS,
    tag: "review",
    offline: () => new ReviewFailed(0, "offline"),
    signedOut: () => new ReviewFailed(401, "login_required"),
  });
  /** @param {string} method @param {string} route @param {unknown} [body] @param {Record<string, string>} [headers]
   * @param {number[] | null} [answers] @returns {Promise<any>} */
  const call = async (method, route, body, headers = {}, answers = null) =>
    dataOf((await request(method, route, body, headers, answers)).reply, `${method} ${route}`);
  /** A call on a share token's route, logged as `what`: the token opens the share to anyone holding it.
   * @param {string} what @param {string} method @param {string} route @param {unknown} [body]
   * @returns {Promise<any>} */
  const tokenCall = async (what, method, route, body) =>
    dataOf((await request(method, route, body, {}, null, what)).reply, what);

  const project = (/** @type {string} */ id) => `${PROJECTS}/${encodeURIComponent(id)}`;
  return {
    /** The signed-in account's email, null when unknown; the record keeps it as the project's owner. */
    signedInEmail,
    /** The spaces this account can share into, personal first.
     * @returns {Promise<import("./types/reviewWire.js").SpaceDTO[]>} */
    spaces: async () => {
      const items = (await call("GET", SPACES))?.items;
      // An answer without a list is not "no spaces": sharing then would pick a workspace nobody chose.
      if (!Array.isArray(items)) throw new ReviewFailed(502, "malformed_spaces");
      return items;
    },
    /** The server's per-account flags on review-spaces, each on only for `true`: `hyperframes-review-version-sharing`
     * and `hyperframes-review-share-files`. One read answers both.
     * @returns {Promise<{ versionSharing: boolean, shareFiles: boolean }>} */
    reviewFlags: async () => {
      const data = await call("GET", SPACES, undefined, {}, SHARING_REFUSALS);
      return {
        versionSharing: data?.version_sharing === true,
        shareFiles: data?.share_files === true,
      };
    },
    /** Registers into `spaceId`; without one the server uses the caller's default space.
     * @param {import("./types/reviewWire.js").RegisterProjectRequest} body @param {string | null} [spaceId]
     * @returns {Promise<ProjectDTO>} */
    register: (body, spaceId) =>
      call("POST", PROJECTS, body, spaceId ? { "x-space-id": spaceId } : {}),
    /** @param {string} id @returns {Promise<ShareDTO>} */
    share: (id) => call("GET", `${project(id)}/share`),
    /** @param {string} id @param {import("./types/reviewWire.js").UpdateProjectShareRequest} body
     * @returns {Promise<ShareDTO>} */
    updateShare: (id, body) => call("PATCH", `${project(id)}/share`, body),
    /** @param {string} id @param {import("./types/reviewWire.js").ProjectOperationRequest} body @returns {Promise<ShareDTO>} */
    linkOn: (id, body) => call("POST", `${project(id)}/share`, body),
    /** @param {string} id @returns {Promise<null>} */
    linkOff: (id) => call("DELETE", `${project(id)}/share`),
    /** @param {string} id @returns {Promise<ProjectDTO>} */
    project: (id) => call("GET", project(id)),
    /** One page of the project's comments, every state. @param {string} id @param {URLSearchParams} query
     * @returns {Promise<import("./types/reviewWire.js").FeedbackPage>} */
    feedback: (id, query) => call("GET", `${project(id)}/feedback?${query}`),
    /** A new version from a local MP4. A body factory runs after sign-in on each attempt.
     * @param {string} id @param {ExportRequest | (() => Promise<ExportRequest>)} body @returns {Promise<ExportDTO>} */
    createExport: (id, body) => call("POST", `${project(id)}/exports`, body),
    /** @param {string} id @param {string} videoId @returns {Promise<ExportDTO>} */
    readExport: (id, videoId) =>
      call("GET", `${project(id)}/exports/${encodeURIComponent(videoId)}`),
    /** The upload is in storage: start processing. @param {string} id @param {string} videoId
     * @returns {Promise<ExportDTO>} */
    completeExport: (id, videoId) =>
      call("POST", `${project(id)}/exports/${encodeURIComponent(videoId)}/complete`),
    /** Attaches the synced snapshot to a version that has none; the same one again is a no-op, another is refused
     * with 409 `snapshot_already_attached`. @param {string} id @param {string} versionId
     * @param {import("./types/reviewWire.js").SnapshotRef} snapshot @returns {Promise<unknown>} */
    attachSnapshot: (id, versionId, snapshot) =>
      call("PUT", `${project(id)}/versions/${encodeURIComponent(versionId)}/snapshot`, snapshot),
    ...shareOpenCalls(tokenCall),
    ...managementClient(call, project, access),
    ...threadWrites(call, project),
  };
}

/** The owner's writes on one thread. @param {(method: string, route: string, body?: unknown) => Promise<any>} call
 * @param {(id: string) => string} project */
function threadWrites(call, project) {
  const thread = (/** @type {string} */ id, /** @type {string} */ rootId) =>
    `${project(id)}/comments/${encodeURIComponent(rootId)}`;
  return {
    /** Accept, dismiss, reopen or resolve a thread. @param {string} id @param {string} rootId
     * @param {{ action: import("./types/review.js").ReviewAction, expected_status_revision: number }} body */
    setStatus: (id, rootId, body) => call("PATCH", `${thread(id, rootId)}/status`, body),
    /** @param {string} id @param {string} rootId
     * @param {{ client_operation_id: string, body: string, attachment_ids: string[] }} body */
    reply: (id, rootId, body) => call("POST", `${thread(id, rootId)}/replies`, body),
  };
}

/** An invite to an email whose grant was revoked: the server keeps the revoked row, leaves it out of the grant list,
 * and takes it back only with that row's revision and a fresh operation ID, so the one revision the client can learn is
 * the conflict's. Null for any other refusal, or one the same revision already got.
 * @param {unknown} error @param {import("./types/reviewWire.js").CreateGrantRequest} body
 * @returns {import("./types/reviewWire.js").CreateGrantRequest | null} */
function regrantOf(error, body) {
  if (!(error instanceof ReviewFailed) || error.reason !== "revision_conflict") return null;
  if (typeof error.currentRevision !== "number") return null;
  // A current revision of 0 is no row at all, which the server asks for as no revision.
  const revision = error.currentRevision || null;
  if (revision === body.expected_revision) return null;
  return { ...body, client_operation_id: randomUUID(), expected_revision: revision };
}

/** Creating a grant, keeping the re-grant `regrantOf` makes as that invitation's retry. The window retries with the
 * operation it first sent; once a re-grant went out under a new operation, that exact re-grant is sent again, so the
 * server's replay recovers a lost answer (or refuses it as revoked since) and no further re-grant is made. It goes
 * exactly when the window drops its own operation: on an answer, on a refusal `rejectedGrantRequest` (the window's own
 * test) calls final, or when the email is invited afresh. Any other refusal, a moderation hold among them, keeps it.
 * @param {(method: string, route: string, body?: unknown) => Promise<any>} call @param {(id: string) => string} project
 * @param {import("./types/access.js").ApiAccess} access */
function grantCreator(call, project, access) {
  /** Re-grants awaiting a final answer, by site, account, project and the operation the window sent.
   * @type {Map<string, { email: string, regrant: import("./types/reviewWire.js").CreateGrantRequest }>} */
  const sent = new Map();
  /** @param {string} route @param {string} key @param {import("./types/reviewWire.js").CreateGrantRequest} body */
  const settle = async (route, key, body) => {
    try {
      const answer = await call("POST", route, body);
      sent.delete(key);
      return answer;
    } catch (error) {
      if (rejectedGrantRequest(error)) sent.delete(key);
      throw error;
    }
  };
  /** @param {string} id @param {import("./types/reviewWire.js").CreateGrantRequest} body
   * @returns {Promise<import("./types/reviewWire.js").AccessGrantDTO>} */
  return async (id, body) => {
    const route = `${project(id)}/access-grants`;
    // expected: signed out, the POST below refuses as login_required; the scope is only a key.
    const who = await access().catch(() => null);
    const scope = grantScope(who, id);
    const key = `${scope}\n${body.client_operation_id}`;
    const retained = sent.get(key);
    if (retained) return settle(route, key, retained.regrant);
    for (const [other, kept] of sent)
      if (other.startsWith(`${scope}\n`) && kept.email === body.email) sent.delete(other);
    try {
      return await call("POST", route, body);
    } catch (error) {
      const regrant = regrantOf(error, body);
      if (!regrant) throw error;
      sent.set(key, { email: body.email, regrant });
      return settle(route, key, regrant);
    }
  };
}

/** @typedef {ReturnType<typeof reviewClient>} ReviewClient
 * @typedef {import("./types/reviewWire.js").ExportRequest} ExportRequest */

/** @param {(method: string, route: string, body?: unknown, headers?: Record<string,string>) => Promise<any>} call
 * @param {(id: string) => string} project @param {import("./types/access.js").ApiAccess} access */
function managementClient(call, project, access) {
  return {
    /** @param {string} id @param {{ title: string, expected_title: string }} body
     * @returns {Promise<{title: string}>} */
    updateTitle: (id, body) => call("PATCH", project(id), body),
    /** @param {string} spaceId @param {string | null} [cursor] @returns
     * {Promise<import("./types/reviewWire.js").ManagedReviewPage>} */
    listProjects: (spaceId, cursor = null) =>
      call("GET", `${PROJECTS}?${new URLSearchParams(cursor ? { cursor } : {})}`, undefined, {
        "x-space-id": spaceId,
      }),
    /** @param {string} id @returns {Promise<null>} */
    removeProject: (id) => call("DELETE", project(id)),
    /** @param {string} id @returns {Promise<{items: import("./types/reviewWire.js").AccessGrantDTO[]}>} */
    grants: async (id) => {
      const items = [];
      const cursors = new Set();
      let cursor = null;
      do {
        const query = new URLSearchParams(cursor ? { cursor } : {});
        const page = await call("GET", `${project(id)}/access-grants?${query}`);
        items.push(...page.items);
        cursor = page.next_cursor;
        if (cursor && (cursors.has(cursor) || cursors.size >= 1000))
          throw new ReviewFailed(502, "malformed_grant_pagination");
        cursors.add(cursor);
      } while (cursor);
      return { items };
    },
    createGrant: grantCreator(call, project, access),
    /** @param {string} id @param {string} grantId @param {{role: import("./types/reviewWire.js").AccessGrantDTO["role"],
     * expected_revision: number}} body @returns {Promise<import("./types/reviewWire.js").AccessGrantDTO>} */
    updateGrant: (id, grantId, body) =>
      call("PATCH", `${project(id)}/access-grants/${encodeURIComponent(grantId)}`, body),
    /** @param {string} id @param {string} grantId @returns {Promise<null>} */
    revokeGrant: (id, grantId) =>
      call("DELETE", `${project(id)}/access-grants/${encodeURIComponent(grantId)}`),
  };
}

/** @param {Awaited<ReturnType<import("./types/access.js").ApiAccess>>} who @param {string} id */
const grantScope = (who, id) => [who?.heygen ?? "", who?.owner ?? "", id].join("\n");
