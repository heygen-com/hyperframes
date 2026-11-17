import { resolve } from "node:path";
import type { Hono } from "hono";
import { requestSubPath } from "@hyperframes/studio-server";
import {
  followReceivedChange,
  onDiskPath,
  receivedContentLeaving,
} from "../utils/receivedRecordFollow.js";

const newPathOf = (body: unknown): string | undefined =>
  body !== null && typeof body === "object" && "newPath" in body && typeof body.newPath === "string"
    ? body.newPath
    : undefined;

const warn = (error: unknown) =>
  console.warn(`[studio] Could not update the received-files record: ${String(error)}`);

/**
 * Follows every Studio rename, move or delete that succeeded in the project's received-files records, whichever
 * client sent it. A record that cannot be changed is left as it was, so the readers count the moved file as received.
 */
export function followReceivedRecords(app: Hono, projectDir: string): void {
  app.on(["PATCH", "DELETE"], "/api/projects/:id/files/*", async (c, next) => {
    const sent =
      c.req.method === "PATCH"
        ? await c.req.raw
            .clone()
            .json()
            .catch(() => null)
        : null;
    const target = onDiskPath(resolve(projectDir, requestSubPath(c.req.url, "projects/:id/files")));
    const left = await receivedContentLeaving(target).catch((error: unknown) => {
      warn(error);
      return [];
    });
    await next();
    if (!c.res.ok) return;
    const newPath = newPathOf(sent);
    const change =
      newPath === undefined
        ? { to: target, left }
        : { from: target, to: onDiskPath(resolve(projectDir, newPath)), left };
    await followReceivedChange(projectDir, change).catch(warn);
  });
}
