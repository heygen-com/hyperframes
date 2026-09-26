import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ID_PATH = join(".hyperframes", "history-id");
/** The only shape minted here; the id is project content and becomes a path, so nothing else is trusted. */
const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function readId(projectDir: string): string | null {
  try {
    const id = readFileSync(join(projectDir, ID_PATH), "utf-8").trim();
    return ID_SHAPE.test(id) ? id : null;
  } catch {
    return null;
  }
}

function recordedDir(historyDir: string): string | null {
  try {
    return JSON.parse(readFileSync(join(historyDir, "project.json"), "utf-8")).dir ?? null;
  } catch {
    return null;
  }
}

/**
 * The project's history id, kept in the project so a rename or move keeps its history. A folder whose id is
 * still carried by the folder that history was recorded for is a copy, and gets an id of its own.
 */
export function projectHistoryId(projectDir: string, historyRoot: string): string {
  const dir = resolve(projectDir);
  let id = readId(dir);
  const was = id && recordedDir(join(historyRoot, id));
  if (!id || (was && was !== dir && existsSync(was) && readId(was) === id)) {
    id = randomUUID();
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, ID_PATH), `${id}\n`);
  }
  mkdirSync(join(historyRoot, id), { recursive: true });
  writeFileSync(join(historyRoot, id, "project.json"), JSON.stringify({ dir }));
  return id;
}
