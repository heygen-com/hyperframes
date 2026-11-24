// @ts-check
import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { projectFingerprint } from "./projectSnapshot.mjs";
import { withProjectShareLock } from "./projectLock.mjs";
import { captureProject } from "./sources/capture.mjs";
import { sourceApi } from "./sources/api.mjs";
import { createProjectShareSourceStore } from "./sources/store.mjs";
import { realWait } from "./sources/transfer.mjs";
import { recoverSourceUpload, uploadSource } from "./sources/upload.mjs";

/** @typedef {import("./sources/adapterTypes.js").SourceResult} SourceResult
 * @typedef {import("./sources/types.js").Binding} Binding */
/** @param {string} reason @returns {SourceResult} */
const unavailable = (reason) => ({ at: "unavailable", reason });
/** Content identity for sharing, including portable hidden render inputs. The Desktop watch inventory stays separate.
 * @param {string} projectPath @returns {Promise<string | null>} */
export async function shareSourceFingerprint(projectPath) {
  const capture = await captureProject(await realpath(projectPath));
  return capture.at === "captured" && !captureRefusal(capture) ? capture.manifest.sha256 : null;
}
/** @param {Binding} binding @param {string} space */
function bindingRefusal(binding, space) {
  if (binding.ownerSpaceId !== space) return "source_other_workspace";
  if (binding.sharedFrom) return "source_owned_by_someone_else";
  if (binding.gettingFromCloud || binding.duplicate) return "source_operation_in_progress";
  return null;
}
/** @param {import("./sources/types.js").Capture} capture */
function captureRefusal(capture) {
  if (capture.at === "too-big") return `source_${capture.over.limit}_exceeded`;
  if (capture.at === "problems") return `source_${capture.problems[0]?.problem ?? "invalid"}`;
  if (capture.settled.agentTurnOpen || capture.settled.projectLocked || capture.waiting.length)
    return "source_edit_in_progress";
  return null;
}

/** Prepare source explicitly before adding the video version. No unexpected network or filesystem failure is
 * converted to video-only. `filesForExport` revalidates the prepared bytes and never starts another upload.
 * @param {import("./sources/adapterTypes.js").SourceOptions} options */
export function shareSources(options) {
  const store = options.store ?? createProjectShareSourceStore();
  const fingerprint = options.fingerprint ?? projectFingerprint;
  const signal = options.signal ?? new AbortController().signal;
  /** @type {Map<string, { rendered: string, digest: string, snapshot: import("./types/reviewWire.js").SnapshotRef, account: string, backend: string }>} */
  const prepared = new Map();
  /** @param {string} projectPath @param {string | null} rendered @returns {Promise<SourceResult>} */
  const prepare = async (projectPath, rendered) => {
    const root = await realpath(projectPath);
    prepared.delete(root);
    if (!enabled(options)) return unavailable("source_disabled");
    if (!rendered || (await fingerprint(root)) !== rendered)
      return unavailable("source_render_changed");
    return withProjectShareLock(
      root,
      "source",
      async () => {
        const signed = await options.access();
        if (!signed?.owner) return unavailable("source_signed_out");
        const key = { backend: signed.heygenApi, account: signed.owner, projectPath: root };
        const guardedAccess = async (/** @type {string | undefined} */ refused) => {
          const next = await options.access(refused);
          if (!next || next.owner !== key.account || next.heygenApi !== key.backend)
            throw new Error("Source account or backend changed while sharing.");
          return next;
        };
        const api =
          options.api ?? sourceApi({ access: guardedAccess, fetchImpl: options.fetchImpl });
        const { own, existing, binding } = await selectBinding(key, options, store);
        const refused = bindingRefusal(binding, options.spaceId);
        if (refused) return unavailable(refused);
        const result = await prepareBinding({
          binding,
          own: Boolean(own),
          external: Boolean(existing),
          api,
          store,
          options,
          signal,
          fingerprint,
          rendered,
        });
        const manifest = result.manifest;
        await guardedAccess(undefined);
        if (result.at !== "ready" || !manifest) return result;
        if (!(await stillMatches(root, rendered, manifest.sha256, fingerprint)))
          return unavailable("source_render_changed");
        prepared.set(root, {
          rendered,
          digest: manifest.sha256,
          snapshot: result.snapshot,
          account: key.account,
          backend: key.backend,
        });
        return { at: "ready", snapshot: result.snapshot };
      },
      { signal },
    );
  };
  /** @param {string} projectPath @param {string | null} rendered */
  const filesForExport = async (projectPath, rendered) => {
    const root = await realpath(projectPath);
    const held = prepared.get(root);
    const signed = await options.access();
    if (
      !held ||
      !rendered ||
      held.rendered !== rendered ||
      !sameOwner(signed, held) ||
      !enabled(options)
    )
      return null;
    return (await stillMatches(root, rendered, held.digest, fingerprint)) ? held.snapshot : null;
  };
  return { prepare, filesForExport };
}

/** @param {import("./sources/adapterTypes.js").SourceOptions} options */
const enabled = (options) => options.enabled?.() ?? true;
/** @param {Awaited<ReturnType<import("./signedInRequest.mjs").SignedInAccess>>} signed
 * @param {{account: string, backend: string}} held */
const sameOwner = (signed, held) =>
  signed?.owner === held.account && signed?.heygenApi === held.backend;
/** @typedef {{ binding: Binding, own: boolean, external: boolean, api: import("./sources/api.mjs").SourceApi,
 * store: import("./sources/adapterTypes.js").SourceStore, options: import("./sources/adapterTypes.js").SourceOptions,
 * signal: AbortSignal, fingerprint: (path: string) => Promise<string | null>, rendered: string }} Preparation */
/** @param {Preparation} job @returns {Promise<SourceResult & {manifest?: import("./sources/types.js").Manifest}>} */
async function prepareBinding(job) {
  const { binding, api, fingerprint, rendered } = job;
  const limits = await api.limits(binding.ownerSpaceId);
  if (!limits.syncAllowed) return unavailable("source_plan_required");
  const capture = await captureProject(binding.projectPath, { limits: limits.push });
  const bad = captureRefusal(capture);
  if (bad) return unavailable(bad);
  if (capture.at !== "captured") return unavailable("source_invalid");
  if ((await fingerprint(binding.projectPath)) !== rendered)
    return unavailable("source_render_changed");
  const result = await snapshotFor(job, capture.manifest, limits);
  return { ...result, manifest: capture.manifest };
}
/** @param {Preparation} job @param {import("./sources/types.js").Manifest} manifest
 * @param {Extract<import("./sources/types.js").SyncLimitsRead, {at: "read"}>} limits @returns {Promise<SourceResult>} */
async function snapshotFor(job, manifest, limits) {
  const { binding, api, store, options, signal } = job;
  const blocked = await recoverEarlierCapture(job, manifest.sha256);
  if (blocked) return blocked;
  if (binding.base?.manifestSha256 === manifest.sha256 && !binding.inflight)
    return reuseSnapshot(api, binding, manifest.sha256);
  if (job.external) return unavailable("source_sync_required");
  if (!job.own && limits.compositions >= limits.maxCompositions)
    return unavailable("source_composition_limit");
  await store.write(binding);
  binding.composition = await api.create(
    binding.ownerSpaceId,
    binding.compositionId,
    basename(binding.projectPath),
  );
  await store.write(binding);
  return uploadSource({ binding, manifest, api, store, signal, ...uploadOptions(options) });
}
/** @param {Preparation} job @param {string} digest */
function recoverEarlierCapture({ external, binding, api, store }, digest) {
  const inflight = binding.inflight;
  if (external || !inflight || inflight.manifestSha256 === digest) return null;
  return recoverSourceUpload({ binding, api, store });
}

/** @param {import("./sources/adapterTypes.js").SourceOptions} options */
function uploadOptions(options) {
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    wait: options.wait ?? realWait,
    timeoutMs: options.verificationTimeoutMs ?? 120_000,
    onProgress: options.onProgress ?? (() => {}),
  };
}

/** @param {import("./sources/types.js").BindingKey} key @param {import("./sources/adapterTypes.js").SourceOptions} options
 * @param {import("./sources/adapterTypes.js").SourceStore} store */
async function selectBinding(key, options, store) {
  const own = await store.read(key);
  const existing = own ? null : await options.existingBinding?.(key);
  return { own, existing, binding: own ?? existing ?? newBinding(key, options.spaceId) };
}
/** @param {import("./sources/types.js").BindingKey} key @param {string} space @returns {Binding} */
function newBinding(key, space) {
  return {
    ...key,
    version: 1,
    compositionId: randomUUID(),
    ownerSpaceId: space,
    boundAt: Date.now(),
    composition: null,
    etag: null,
    base: null,
    inflight: null,
  };
}
/** @param {import("./sources/api.mjs").SourceApi} api @param {Binding} binding @param {string} digest @returns {Promise<SourceResult>} */
async function reuseSnapshot(api, binding, digest) {
  if (!binding.base) return unavailable("source_sync_required");
  const remote = await api.snapshot(
    binding.ownerSpaceId,
    binding.compositionId,
    binding.base.snapshotId,
  );
  if (
    remote.id !== binding.base.snapshotId ||
    remote.compositionId !== binding.compositionId ||
    remote.manifestSha256 !== digest ||
    remote.manifest?.sha256 !== digest ||
    remote.publicationOutcome !== "published"
  )
    return unavailable("source_snapshot_mismatch");
  return {
    at: "ready",
    snapshot: {
      space_id: binding.ownerSpaceId,
      composition_id: binding.compositionId,
      snapshot_id: remote.id,
    },
  };
}
/** @param {string} root @param {string} rendered @param {string} digest @param {(path: string) => Promise<string | null>} fingerprint */
async function stillMatches(root, rendered, digest, fingerprint) {
  if ((await fingerprint(root)) !== rendered) return false;
  const capture = await captureProject(root);
  return (
    !captureRefusal(capture) &&
    capture.at === "captured" &&
    capture.manifest.sha256 === digest &&
    (await fingerprint(root)) === rendered
  );
}
export { createProjectShareSourceStore } from "./sources/store.mjs";
