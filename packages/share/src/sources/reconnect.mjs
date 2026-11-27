// @ts-check
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { shareSourceFingerprint } from "../shareSources.mjs";
import { withProjectShareLock } from "../projectLock.mjs";
import { sourceApi } from "./api.mjs";
import { createProjectShareSourceStore, directoryIdentity } from "./store.mjs";

/** A host keeps one picker per interactive session. Project files cannot nominate a destination.
 * @param {{projectPath:string, access:import("../signedInRequest.mjs").SignedInAccess,
 * workspace:(requested?:string)=>Promise<{id:string,name:string} | null>,
 * store?:import("./adapterTypes.js").SourceStore, fetchImpl?:typeof fetch}} options */
export function sourceReconnect(options) {
  const store = options.store ?? createProjectShareSourceStore();
  async function bindingKey() {
    const signed = await options.access();
    if (!signed?.owner) throw new Error("Sign in to reconnect a project.");
    return {
      projectPath: await realpath(options.projectPath),
      account: signed.owner,
      backend: signed.heygenApi,
    };
  }
  /** @param {import("./types.js").BindingKey} key */
  async function unboundDirectory(key) {
    if (await store.read(key)) throw new Error("This folder already has a sync destination.");
    return directoryIdentity(key.projectPath);
  }
  /** @param {import("./types.js").BindingKey} key */
  function session(key) {
    const access = async (/** @type {string | undefined} */ refused) => {
      const signed = await options.access(refused);
      if (signed?.owner !== key.account || signed.heygenApi !== key.backend)
        throw new Error("The account or workspace changed. Choose the project again.");
      return signed;
    };
    return {
      check: () => access(undefined),
      api: sourceApi({ access, fetchImpl: options.fetchImpl }),
    };
  }
  /** @typedef {{key:import("./types.js").BindingKey,directory:string,
   * space:{id:string,name:string},project:import("./types.js").Composition, localDigest?:string}} Offer */
  /** @type {Map<string,Offer>} */
  const offers = new Map();
  return {
    available: async () => !(await store.read(await bindingKey())),
    list: async (/** @type {string | undefined} */ requested) => {
      offers.clear();
      const key = await bindingKey();
      const directory = await unboundDirectory(key);
      const space = await options.workspace(requested);
      if (!space || (requested && space.id !== requested))
        throw new Error("Project sync is unavailable in this workspace.");
      const { api } = session(key);
      const projects = await api.list(space.id);
      return projects.map((project) => {
        if (project.spaceId !== space.id) throw new Error("Cloud project workspace mismatch.");
        const token = randomUUID();
        offers.set(token, { key, space, directory, project });
        return { token, id: project.id, title: project.title, workspace: space };
      });
    },
    confirm: async (/** @type {string} */ token) => {
      const offer = offers.get(token);
      offers.clear();
      if (!offer) throw new Error("Choose a cloud project again before reconnecting.");
      const { key, space } = offer;
      const { check, api } = session(key);
      return withProjectShareLock(key.projectPath, "source", async () => {
        await check();
        const current = await options.workspace(space.id);
        if (current?.id !== space.id || current.name !== space.name)
          throw new Error("The workspace changed. Choose the project again.");
        const project = await api.get(space.id, offer.project.id);
        if (!sameProject(project, offer.project))
          throw new Error("The cloud project changed. Review its destination again.");
        const base = await confirmedBase(api, project);
        const divergent = await divergentDigest(key.projectPath, base, offer.localDigest);
        await check();
        if (
          (await realpath(options.projectPath)) !== key.projectPath ||
          (await unboundDirectory(key)) !== offer.directory
        )
          throw new Error("The local folder changed. Choose the project again.");
        if (divergent) {
          const confirmLocalFiles = randomUUID();
          offers.set(confirmLocalFiles, { ...offer, localDigest: divergent });
          return { confirmLocalFiles };
        }
        await store.write({
          ...key,
          version: 1,
          compositionId: project.id,
          ownerSpaceId: space.id,
          composition: project,
          boundAt: Date.now(),
          etag: null,
          inflight: null,
          base,
        });
        return null;
      });
    },
  };
}

/** @param {import("./api.mjs").SourceApi} api @param {import("./types.js").Composition} project */
async function confirmedBase(api, project) {
  if (!project.latestSnapshotId) return null;
  const snapshot = await api.snapshot(project.spaceId, project.id, project.latestSnapshotId);
  if (
    !snapshot.manifest ||
    snapshot.compositionId !== project.id ||
    snapshot.id !== project.latestSnapshotId ||
    snapshot.publicationOutcome !== "published"
  )
    throw new Error("Could not verify the cloud project's latest version.");
  return {
    snapshotId: snapshot.id,
    manifest: snapshot.manifest.document,
    manifestSha256: snapshot.manifest.sha256,
  };
}

/** @param {import("./types.js").Composition} current @param {import("./types.js").Composition} shown */
function sameProject(current, shown) {
  return (
    current.id === shown.id &&
    current.spaceId === shown.spaceId &&
    current.title === shown.title &&
    current.latestSnapshotId === shown.latestSnapshotId
  );
}

/** @param {string} path @param {import("./types.js").Binding["base"]} base @param {string | undefined} approved */
async function divergentDigest(path, base, approved) {
  if (!base) return null;
  const digest = await shareSourceFingerprint(path);
  if (!digest)
    throw new Error(
      "Could not compare this folder with the published version. Finish any edits and retry.",
    );
  if (approved && approved !== digest)
    throw new Error("The local files changed. Choose the project again.");
  return digest === base.manifestSha256 || digest === approved ? null : digest;
}
