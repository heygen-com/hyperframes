// @ts-check
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { errorCode, mkdirInside, writeJsonAtomic } from "../storage.mjs";
import { localBaseDigest, readUploadIntent } from "./manifest.mjs";

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
      localBaseDigest(raw.base.manifest) !== raw.base.manifestSha256)
  )
    throw new Error("Invalid source base snapshot.");
  if (raw.inflight === null) return;
  if (!object(raw.inflight) || typeof raw.inflight.idempotencyKey !== "string")
    throw new Error("Invalid pending source upload.");
  readUploadIntent(raw.inflight);
}

/** @param {string} path */
export async function directoryIdentity(path) {
  const info = await stat(path, { bigint: true });
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`;
}

/** Default sync destinations belong to this install. Never import a binding from a project.
 * @returns {import("./adapterTypes.js").SourceStore} */
export function createProjectShareSourceStore() {
  const config = process.env.HYPERFRAMES_CONFIG_DIR || join(homedir(), ".hyperframes");
  /** @param {import("./types.js").BindingKey} key */
  const location = async (key) => {
    if (!isAbsolute(config))
      throw new Error("Source sync requires an absolute configuration directory.");
    await mkdir(config, { recursive: true, mode: 0o700 });
    const root = await realpath(config);
    const relativeConfig = relative(key.projectPath, join(root, "source-bindings"));
    if (
      !(
        relativeConfig === ".." ||
        relativeConfig.startsWith(`..${sep}`) ||
        isAbsolute(relativeConfig)
      )
    )
      throw new Error("The source sync configuration directory must be outside the project.");
    const dir = await mkdirInside(root, "source-bindings", 0o700);
    const id = createHash("sha256")
      .update(JSON.stringify([key.backend, key.projectPath]))
      .digest("hex");
    return join(dir, `${id}.json`);
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
        const record = JSON.parse(await handle.readFile("utf8"));
        const { directoryId, ...binding } = record;
        if (directoryId !== (await directoryIdentity(key.projectPath))) return null;
        return bindingOf(binding, key);
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
      await writeJsonAtomic(file, {
        ...binding,
        directoryId: await directoryIdentity(binding.projectPath),
      });
    },
  };
}
