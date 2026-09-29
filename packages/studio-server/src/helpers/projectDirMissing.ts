import type { Context } from "hono";

const PROJECT_DIR_MISSING = { error: "not found", why: "project_dir_missing" };

export const projectDirMissing = (c: {
  json: (data: { error: string; why: string }, status: 404) => Response;
}) => c.json(PROJECT_DIR_MISSING, 404);

export function replaceWithProjectDirMissing(c: Context, hostHeaders: Headers): void {
  hostHeaders.delete("content-type");
  c.res = undefined;
  c.res = Response.json(PROJECT_DIR_MISSING, { status: 404, headers: hostHeaders });
}
