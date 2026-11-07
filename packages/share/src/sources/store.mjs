// @ts-check
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { errorCode, mkdirInside, writeJsonAtomic } from "../storage.mjs";
import { parseStoredManifest } from "./manifest.mjs";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const object = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} raw @param {import("./types.js").BindingKey} key @returns {import("./types.js").Binding} */
function bindingOf(raw, key) {
  if (
    !object(raw) ||
    raw.version !== 1 ||
    raw.backend !== key.backend ||
    raw.account !== key.account ||
    raw.projectPath !== key.projectPath ||
    typeof raw.compositionId !== "string" ||
    typeof raw.ownerSpaceId !== "string"
  )
    throw new Error(
      "Source binding belongs to another account, backend or project. Reset explicitly before sharing this copy.",
    );
  checkSnapshots(raw);
  return /** @type {import("./types.js").Binding} */ (/** @type {unknown} */ (raw));
}

/** @param {Record<string, unknown>} raw */
function checkSnapshots(raw) {
  if (
    raw.base !== null &&
    (!object(raw.base) ||
      typeof raw.base.snapshotId !== "string" ||
      parseStoredManifest(raw.base.manifest).sha256 !== raw.base.manifestSha256)
  )
    throw new Error("Invalid source base snapshot.");
  if (
    raw.inflight !== null &&
    (!object(raw.inflight) ||
      typeof raw.inflight.idempotencyKey !== "string" ||
      parseStoredManifest(raw.inflight.manifest).sha256 !== raw.inflight.manifestSha256)
  )
    throw new Error("Invalid pending source upload.");
}

/** Project-local state is excluded by the portable source policy. Account/root mismatches fail closed, including copied folders.
 * @returns {import("./adapterTypes.js").SourceStore} */
export function createProjectShareSourceStore() {
  /** @param {import("./types.js").BindingKey} key */
  const location = async (key) => {
    const dir = await mkdirInside(key.projectPath, ".hyperframes");
    const environment = createHash("sha256").update(key.backend).digest("hex").slice(0, 16);
    return join(dir, `share-sync.${environment}.json`);
  };
  return {
    read: async (key) => {
      const file = await location(key);
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch((error) => {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      });
      if (!handle) return null;
      try {
        if (!(await handle.stat()).isFile())
          throw new Error("Source binding must be a regular file.");
        return bindingOf(JSON.parse(await handle.readFile("utf8")), key);
      } finally {
        await handle.close();
      }
    },
    write: async (binding) => {
      const file = await location(binding);
      const held = await lstat(file).catch((error) => {
        if (errorCode(error) === "ENOENT") return null;
        throw error;
      });
      if (held && !held.isFile()) throw new Error("Source binding must be a regular file.");
      await writeJsonAtomic(file, binding);
    },
  };
}
