import { existsSync, statSync } from "node:fs";
import type { Context, Hono } from "hono";
import { terminalText } from "@hyperframes/core/terminal-text";
import { requestSubPath } from "@hyperframes/studio-server";
import { resolveWritableWithinProject } from "@hyperframes/studio-server/safe-path";
import {
  dropReceivedArrivals,
  dropReceivedLeavers,
  keepListedInFolder,
  onDiskPath,
  plannedReceivedChange,
  type ReceivedChange,
  recordReceivedArrivals,
  relistHistoryWrites,
  relistReceivedContent,
} from "../utils/receivedRecordFollow.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const textAt = (value: unknown, key: string): string[] =>
  isObject(value) && typeof value[key] === "string" ? [value[key]] : [];

const listAt = (value: unknown, key: string): unknown[] =>
  isObject(value) && Array.isArray(value[key]) ? value[key] : [];

const warn = (error: unknown) =>
  console.warn(
    `[studio] Could not update the received-files record: ${terminalText(String(error))}`,
  );

const busy = (c: Context) =>
  c.json(
    { error: "Could not update the received-files record; try again.", why: "record_busy" },
    409,
  );

const notFound = (c: Context) => c.json({ error: "not found" }, 404);

const jsonBody = (c: Context): Promise<unknown> =>
  c.req.raw
    .clone()
    .json()
    .catch(() => null);

/** A project file the request may change, spelled as it is on disk; null when the route will refuse the path. */
function writablePath(projectDir: string, path: string): string | null {
  const found = path ? resolveWritableWithinProject(projectDir, path) : null;
  return found && existsSync(found) ? onDiskPath(found) : null;
}

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;

async function requestedChange(
  c: Context,
  projectDir: string,
): Promise<{ from: string; to?: string } | null> {
  const named = requestSubPath(c.req.url, "projects/:id/files");
  const from = named === null ? null : writablePath(projectDir, named);
  if (from === null) return null;
  if (c.req.method !== "PATCH") return { from };
  const newPath = textAt(await jsonBody(c), "newPath")[0];
  const kind = statSync(from, { throwIfNoEntry: false })?.isDirectory() ? "folder" : "file";
  const to = newPath ? resolveWritableWithinProject(projectDir, newPath, kind) : null;
  return to === null ? null : { from, to: onDiskPath(to) };
}

async function startedChange(
  projectDir: string,
  { from, to }: { from: string; to?: string },
): Promise<ReceivedChange | null> {
  if (!(await keepListedInFolder(projectDir, from))) return null;
  return plannedReceivedChange(projectDir, from, to)
    .then(recordReceivedArrivals)
    .catch(() => null);
}

/**
 * Follows a Studio rename, move or delete in the received-files records. Before the files move, every file listed in
 * a record inside a moved or deleted folder is listed in the project's own record, the received content leaving a
 * listed path is kept, and a renamed file is listed under the path it moves to; when that fails, the request is refused.
 * Afterwards an old line goes once its file is listed where it sits; a non-media file deleted or made media stays.
 */
function followMovesAndDeletes(app: Hono, projectDir: string): void {
  app.on(["PATCH", "DELETE"], "/api/projects/:id/files/*", async (c, next) => {
    if (requestSubPath(c.req.url, "projects/:id/files") === null) return notFound(c);
    const requested = await requestedChange(c, projectDir);
    if (requested === null) return next();
    const change = await startedChange(projectDir, requested);
    if (change === null) return busy(c);
    await next();
    await (c.res.ok ? dropReceivedLeavers(change) : dropReceivedArrivals(change)).catch(warn);
  });
}

/** Undo, redo and restore: every file they write that holds received content is listed again. */
function followHistory(app: Hono, projectDir: string): void {
  const routes = ["step", "undo", "restore"].map((name) => `/api/projects/:id/history/${name}`);
  app.on("POST", routes, async (c, next) => {
    await next();
    if (!c.res.ok) return;
    const sent: unknown = await c.res
      .clone()
      .json()
      .catch(() => null);
    const entry = isObject(sent) && isObject(sent.entry) ? sent.entry : sent;
    const files = listAt(entry, "files").flatMap((file) =>
      textAt(file, "path").map((path) => ({ path })),
    );
    await relistHistoryWrites(projectDir, { files }).catch(warn);
  });
}

const SAVES_NAMING_THE_FILE = [
  "files",
  "file-mutations/:operation",
  "gsap-mutations",
  "gsap-mutations-batch",
  "gsap-mutation-rollback",
];

async function savedPaths(c: Context): Promise<string[] | null> {
  const route = SAVES_NAMING_THE_FILE.find((prefix) =>
    c.req.routePath.startsWith(`/api/projects/:id/${prefix}/`),
  );
  const named = route === undefined ? "" : requestSubPath(c.req.url, `projects/:id/${route}`);
  if (named === null) return null;
  if (named) return [named];
  const body = await jsonBody(c);
  return [
    ...textAt(body, "path"),
    ...listAt(body, "files").flatMap((file) => textAt(file, "path")),
    ...listAt(body, "batches").flatMap((batch) => textAt(batch, "sourceFile")),
  ];
}

/**
 * A Studio save to a file that holds received content no record lists lists that file first, so the edit leaves it
 * received; when the record cannot take it, the save is refused.
 */
function followSaves(app: Hono, projectDir: string): void {
  const relistBeforeSave = async (c: Context, next: () => Promise<void>) => {
    const saved = await savedPaths(c);
    if (saved === null) return notFound(c);
    const paths = saved.flatMap((path) => writablePath(projectDir, path) ?? []);
    try {
      await relistReceivedContent(projectDir, paths.filter(isFile));
    } catch {
      return busy(c);
    }
    return next();
  };
  app.put("/api/projects/:id/files/*", relistBeforeSave);
  app.on(
    "POST",
    SAVES_NAMING_THE_FILE.slice(1).map((prefix) => `/api/projects/:id/${prefix}/*`),
    relistBeforeSave,
  );
}

/** Keeps the project's received-files records true to Studio's file requests, whichever client sent them. */
export function followReceivedRecords(app: Hono, projectDir: string): void {
  followMovesAndDeletes(app, projectDir);
  followHistory(app, projectDir);
  followSaves(app, projectDir);
}
