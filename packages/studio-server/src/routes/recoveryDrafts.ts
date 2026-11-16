import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { replaceFileAtomically } from "@hyperframes/core/atomic-file";
import { requestSubPath } from "../helpers/requestSubPath.js";
import { isLinkFreeWithinProject, mkdirOwnedWithinProject } from "../helpers/safePath.js";
import type { StudioApiAdapter } from "../types.js";

const ROUTE = "projects/:id/recovery-drafts";
const DRAFTS = join(".hyperframes", "recovery");

const isText = (value: unknown): value is string => typeof value === "string";
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value);

/** The fields a draft keeps; its project, path and time come from the request, never the body. */
function draftFields(body: unknown): Record<string, unknown> | null {
  const { kind, studioContent, externalVersion, externalContent, failureMessage } = (body ??
    {}) as Record<string, unknown>;
  const message = kind === "failed" ? failureMessage : kind === "conflict" ? "" : null;
  const valid =
    [studioContent, message].every(isText) &&
    [externalVersion, externalContent].every(isTextOrNull);
  return valid ? { kind, studioContent, externalVersion, externalContent, failureMessage } : null;
}

/** A draft holds two copies of a file the files route reads up to 32 MB of. */
const MAX_DRAFT_BYTES = 96 * 1024 * 1024;

function readDraft(file: string): unknown {
  let fd: number;
  try {
    // Nonblocking: a FIFO in a received project would otherwise hold the open, and the server, for a writer.
    fd = openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
  } catch {
    return null;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_DRAFT_BYTES) return null;
    return JSON.parse(readFileSync(fd, "utf-8"));
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

type Target = {
  projectId: string;
  projectDir: string;
  filePath: string;
  dir: string;
  file: string;
};

async function draftTarget(c: Context, adapter: StudioApiAdapter): Promise<Target | Response> {
  const project = await adapter.resolveProject(c.req.param("id") ?? "");
  if (!project) return c.json({ error: "not found" }, 404);
  const filePath = requestSubPath(c.req.url, ROUTE);
  if (!filePath || filePath.includes("\0")) return c.json({ error: "bad path" }, 400);
  const dir = join(project.dir, DRAFTS);
  if (!isLinkFreeWithinProject(project.dir, dir)) return c.json({ error: "not a folder" }, 409);
  const file = join(dir, `${createHash("sha256").update(filePath).digest("hex")}.json`);
  return { projectId: project.id, projectDir: project.dir, filePath, dir, file };
}

function storedDraft({ projectId, filePath, file }: Target) {
  const stored = readDraft(file);
  const fields = draftFields(stored);
  const at = (stored as { createdAt?: unknown } | null)?.createdAt;
  return fields && { ...fields, projectId, filePath, createdAt: typeof at === "number" ? at : 0 };
}

/** Studio's unsaved draft of one file, kept in that project's own `.hyperframes`, so only its own session made it. */
export function registerRecoveryDraftRoutes(api: Hono, adapter: StudioApiAdapter): void {
  const path = `/${ROUTE}/*`;
  api.get(path, async (c) => {
    const target = await draftTarget(c, adapter);
    return target instanceof Response ? target : c.json({ draft: storedDraft(target) });
  });
  api.delete(path, async (c) => {
    const target = await draftTarget(c, adapter);
    if (target instanceof Response) return target;
    rmSync(target.file, { force: true });
    return c.json({ ok: true });
  });
  api.put(path, async (c) => {
    const target = await draftTarget(c, adapter);
    if (target instanceof Response) return target;
    const fields = draftFields(await c.req.json().catch(() => null));
    if (!fields) return c.json({ error: "invalid draft" }, 400);
    mkdirOwnedWithinProject(target.projectDir, target.dir);
    replaceFileAtomically(target.file, JSON.stringify({ ...fields, createdAt: Date.now() }), 0o600);
    return c.json({ ok: true });
  });
}
