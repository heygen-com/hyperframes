// @ts-check
// What the HyperFrames CLI keeps in a project's .hyperframes folder that a capture must honour: render outputs written
// outside renders/ (left out of every manifest), an open agent turn and a held project lock (no capture until both
// end). The formats are the pinned hyperframes CLI's, version 1 of render-outputs.json.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** A predicate for the paths the project's render-outputs.json lists, and everything under them; none when the file
 * is missing or not version 1. @param {string} root @returns {Promise<(rel: string) => boolean>} */
export async function readRenderOutputs(root) {
  const raw = await readFile(join(root, ".hyperframes", "render-outputs.json"), "utf8").catch(
    () => null,
  );
  /** @type {{ version?: unknown, paths?: unknown } | null} */
  let record = null;
  try {
    record = raw === null ? null : JSON.parse(raw);
  } catch {
    record = null;
  }
  const paths =
    record?.version === 1 && Array.isArray(record.paths)
      ? record.paths
          .filter((path) => typeof path === "string")
          .map((path) => path.replace(/\\/g, "/"))
      : [];
  const listed = new Set(paths);
  return (rel) => listed.has(rel) || paths.some((path) => rel.startsWith(`${path}/`));
}

/** Whether a pid still runs: EPERM is a process another user owns. @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
}

/** An open agent turn (its history-turn.json exists) or a project lock whose holder still runs.
 * @param {string} root */
export async function settledState(root) {
  const dir = join(root, ".hyperframes");
  const turn = await readFile(join(dir, "history-turn.json")).then(
    () => true,
    () => false,
  );
  const lock = await readFile(join(dir, "project.lock"), "utf8").catch(() => null);
  /** @type {{ pid?: unknown } | null} */
  let holder = null;
  try {
    holder = lock === null ? null : JSON.parse(lock);
  } catch {
    holder = null;
  }
  const locked = lock !== null && (typeof holder?.pid !== "number" || alive(holder.pid));
  return { agentTurnOpen: turn, projectLocked: locked };
}
