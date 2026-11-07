// @ts-check
import { signedInRequest } from "../signedInRequest.mjs";
import { SyncApiError, refusalOf } from "./errors.mjs";
import {
  beginOf,
  grantsOf,
  objectOf,
  uploadOf,
  syncLimitsOf,
  compositionOf,
  snapshotOf,
} from "./wire.mjs";

/** @param {{ access: import("../signedInRequest.mjs").SignedInAccess, fetchImpl?: typeof fetch }} deps */
export function sourceApi({ access, fetchImpl = fetch }) {
  const request = signedInRequest({
    access,
    fetchImpl,
    timeoutMs: 120_000,
    tag: "share-source",
    host: "heygenApi",
    offline: () => new SyncApiError("offline"),
    signedOut: () => new SyncApiError("signed-out"),
  });
  /** @param {string} method @param {string} route @param {unknown} [body] @param {Record<string,string>} [headers] */
  const send = async (method, route, body, headers) => {
    const { reply } = await request(method, route, body, headers);
    if (!reply.ok) throw await refusalOf(reply);
    return objectOf(await reply.json(), "envelope").data;
  };
  /** @param {string} space @param {string} composition */
  const path = (space, composition) =>
    `/v3/hyperframes/workspaces/${encodeURIComponent(space)}/compositions/${encodeURIComponent(composition)}`;
  return {
    /** @param {string} space */
    limits: async (space) =>
      syncLimitsOf(
        await send(
          "GET",
          `/v3/hyperframes/workspaces/${encodeURIComponent(space)}/composition-sync/limits`,
        ),
      ),
    /** @param {string} space @param {string} composition @param {string} title */
    create: async (space, composition, title) =>
      compositionOf(await send("PUT", path(space, composition), { title })),
    /** @param {string} space @param {string} composition @param {string} snapshot */
    snapshot: async (space, composition, snapshot) =>
      snapshotOf(
        await send(
          "GET",
          `${path(space, composition)}/snapshots/${encodeURIComponent(snapshot)}?include=manifest`,
        ),
      ),
    /** @param {string} space @param {string} composition @param {import("./types.js").BeginRequest} body */
    begin: async (space, composition, body) =>
      beginOf(
        await send(
          "POST",
          `${path(space, composition)}/uploads`,
          {
            base_snapshot_id: body.baseSnapshotId,
            resolves_conflict_snapshot_ids: [],
            client_type: "cli",
            manifest_sha256: body.manifest.sha256,
            manifest: body.manifest.document,
          },
          { "Idempotency-Key": body.idempotencyKey },
        ),
        false,
      ),
    /** @param {string} space @param {string} composition @param {string} upload @param {import("./types.js").GrantRequest[]} files */
    uploadUrls: async (space, composition, upload, files) =>
      grantsOf(
        await send(
          "POST",
          `${path(space, composition)}/uploads/${encodeURIComponent(upload)}/upload-urls`,
          {
            files: files.map((file) => ({
              sha256: file.sha256,
              ...(file.multipartUploadId && { multipart_upload_id: file.multipartUploadId }),
              ...(file.parts && {
                parts: file.parts.map((part) => ({
                  part_number: part.partNumber,
                  sha256: part.sha256,
                })),
              }),
            })),
          },
        ),
      ),
    /** @param {string} space @param {string} composition @param {string} upload */
    status: async (space, composition, upload) =>
      uploadOf(
        await send("GET", `${path(space, composition)}/uploads/${encodeURIComponent(upload)}`),
      ),
    /** @param {string} space @param {string} composition @param {string} upload */
    cancel: async (space, composition, upload) =>
      uploadOf(
        await send(
          "POST",
          `${path(space, composition)}/uploads/${encodeURIComponent(upload)}/cancel`,
        ),
      ),
    /** @param {string} space @param {string} composition @param {string} upload */
    submit: async (space, composition, upload) =>
      uploadOf(
        await send(
          "POST",
          `${path(space, composition)}/uploads/${encodeURIComponent(upload)}/verification`,
        ),
      ),
  };
}
/** @typedef {ReturnType<typeof sourceApi>} SourceApi */
