// @ts-check
// Open in Studio's calls (docs/sync-backed-sharing/contracts.md C1-C3): what a share opens to, the version's files for
// a copy, and the copy's log.

const REVIEWS = "/v1/hyperframes/reviews";

/** @param {(what: string, method: string, route: string, body?: unknown) => Promise<any>} tokenCall */
export function shareOpenCalls(tokenCall) {
  const share = (/** @type {string} */ token) => `${REVIEWS}/${encodeURIComponent(token)}`;
  const version = (/** @type {string} */ token, /** @type {string} */ id) =>
    `${share(token)}/versions/${encodeURIComponent(id)}`;
  return {
    /** C1, for the requested version or the latest. @param {string} token @param {string | null} versionId
     * @returns {Promise<import("./types/shareOpen.js").OpenSummaryDTO>} */
    openSummary: (token, versionId) =>
      tokenCall(
        "GET reviews/…/open",
        "GET",
        `${share(token)}/open${versionId ? `?${new URLSearchParams({ version_id: versionId })}` : ""}`,
      ),
    /** C2: the snapshot's manifest and the first signed URLs (at most 500 files).
     * @param {string} token @param {string} versionId @returns {Promise<import("./types/shareOpen.js").VersionFilesDTO>} */
    versionFiles: (token, versionId) =>
      tokenCall("GET reviews/…/files", "GET", `${version(token, versionId)}/files`),
    /** C2's refresh: URLs for `sha256s` (at most 500) of the same snapshot, by the token the last answer carried.
     * @param {string} token @param {string} versionId @param {string} continuation @param {string[]} sha256s
     * @returns {Promise<import("./types/shareOpen.js").FileUrlsDTO>} */
    fileUrls: (token, versionId, continuation, sha256s) =>
      tokenCall("POST reviews/…/files", "POST", `${version(token, versionId)}/files`, {
        continuation_token: continuation,
        sha256s,
      }),
    /** C3: a copy finished; the same handoff again is the same copy. The server answers 204 with no body.
     * @param {string} token @param {string} versionId @param {string | null} handoffId @returns {Promise<null>} */
    logCopy: (token, versionId, handoffId) =>
      tokenCall("POST reviews/…/copies", "POST", `${version(token, versionId)}/copies`, {
        handoff_id: handoffId,
      }),
  };
}
