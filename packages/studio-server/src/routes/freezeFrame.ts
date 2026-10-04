import { execFile } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import type { Hono } from "hono";
import { findFfBinary } from "@hyperframes/parsers/ff-binaries";
import type { StudioApiAdapter } from "../types.js";
import { mkdirWithinProject, pinWithinProject } from "../helpers/safePath.js";
import {
  atomicTempPath,
  createFileAtomically,
  replaceFileAtomically,
} from "@hyperframes/core/atomic-file";
import { backupPathForResponse, snapshotBeforeWrite } from "../helpers/backupJournal.js";
import {
  createWriteToken,
  fileContentVersion,
  recordFileWriteReceipt,
} from "../helpers/fileVersion.js";
import {
  applyFreezeFrameToHtml,
  freezeExtractArgs,
  freezeStillFileName,
  randomStillToken,
  readFreezeSource,
  type FreezeSource,
} from "../helpers/freezeFrame.js";
import type { SourceMutationTarget } from "../helpers/sourceMutation.js";

export type FrameExtractor = (args: string[]) => Promise<{ ok: boolean; error?: string }>;

const EXTRACT_TIMEOUT_MS = 30_000;

const ffmpegExtractor: FrameExtractor = (args) => {
  const ffmpeg = findFfBinary("ffmpeg", { configuredMustExist: true });
  if (!ffmpeg) return Promise.resolve({ ok: false, error: "ffmpeg not found" });
  return new Promise((resolvePromise) => {
    execFile(
      ffmpeg,
      args,
      { timeout: EXTRACT_TIMEOUT_MS, windowsHide: true },
      (error, _o, stderr) =>
        resolvePromise(
          error ? { ok: false, error: String(stderr || error.message) } : { ok: true },
        ),
    );
  });
};

interface FreezeFrameRequest {
  path: string;
  expectedVersion: string;
  target: SourceMutationTarget;
  playhead: number;
  transactionToken?: string;
}

function isFreezeFrameRequest(value: unknown): value is FreezeFrameRequest {
  if (typeof value !== "object" || value === null) return false;
  const body: Partial<Record<keyof FreezeFrameRequest, unknown>> = value;
  return (
    typeof body.path === "string" &&
    body.path.length > 0 &&
    typeof body.expectedVersion === "string" &&
    typeof body.target === "object" &&
    body.target !== null &&
    typeof body.playhead === "number" &&
    Number.isFinite(body.playhead)
  );
}

const FREEZE_DIR = ["assets", "freeze"];

type Failure = { error: string; status: 403 | 404 | 409 | 500 };

function readExpected(absPath: string, expectedVersion: string): { content: string } | Failure {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return { error: "not found", status: 404 };
  }
  return fileContentVersion(content) === expectedVersion
    ? { content }
    : { error: "file conflict", status: 409 };
}

function readFrame(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function publishStill(path: string, frame: Buffer): boolean {
  try {
    createFileAtomically(path, frame);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** ffmpeg writes under a temp name the project history skips, so the still appears whole or not at all. */
async function extractAndPublish(
  extract: FrameExtractor,
  mediaPath: string,
  mediaTime: number,
  imagePath: string,
): Promise<Failure | null> {
  const tempPath = atomicTempPath(imagePath);
  try {
    const extracted = await extract(freezeExtractArgs(mediaPath, mediaTime, tempPath));
    const frame = extracted.ok ? readFrame(tempPath) : null;
    if (!frame?.length) {
      const reason = extracted.ok ? "no frame at this time" : (extracted.error ?? "ffmpeg failed");
      return { error: `Could not extract the frame: ${reason}`, status: 500 };
    }
    if (publishStill(imagePath, frame)) return null;
    return { error: `freeze still already exists: ${basename(imagePath)}`, status: 409 };
  } finally {
    rmSync(tempPath, { force: true });
  }
}

async function extractStill(
  projectDir: string,
  absPath: string,
  source: FreezeSource,
  playhead: number,
  tools: { extract: FrameExtractor; stillToken: () => string },
): Promise<{ imageSrc: string; stillPath: string; imagePath: string } | Failure> {
  const fileDir = dirname(absPath);
  const mediaPath = pinWithinProject(projectDir, relative(projectDir, join(fileDir, source.src)));
  if (!mediaPath) return { error: `forbidden media path: ${source.src}`, status: 403 };
  const freezeDir = join(projectDir, ...FREEZE_DIR);
  const fileName = freezeStillFileName(source.id, playhead, tools.stillToken());
  mkdirWithinProject(projectDir, freezeDir);
  const imagePath = pinWithinProject(projectDir, join(...FREEZE_DIR, fileName));
  if (!imagePath || dirname(imagePath) !== freezeDir) {
    return { error: `forbidden freeze path: ${fileName}`, status: 403 };
  }
  const failed = await extractAndPublish(tools.extract, mediaPath, source.mediaTime, imagePath);
  if (failed) return failed;
  const depth = relative(projectDir, fileDir).split(sep).filter(Boolean).length;
  const stillPath = `${FREEZE_DIR.join("/")}/${fileName}`;
  return { imageSrc: `${"../".repeat(depth)}${stillPath}`, stillPath, imagePath };
}

function writeFolded(
  projectDir: string,
  absPath: string,
  path: string,
  before: string,
  after: string,
  options: { token?: string },
): { version: string; writeToken: string; backupPath: string | null } | Failure {
  if (readFileSync(absPath, "utf-8") !== before) {
    return { error: `file conflict: ${path}`, status: 409 };
  }
  const backup = snapshotBeforeWrite(projectDir, absPath);
  if (backup.error) return { error: `Failed to create backup: ${backup.error}`, status: 500 };
  const writeToken = createWriteToken(options.token);
  replaceFileAtomically(absPath, after, statSync(absPath).mode);
  const version = fileContentVersion(after);
  recordFileWriteReceipt(absPath, { path, version, writeToken, overwrote: before });
  return { version, writeToken, backupPath: backupPathForResponse(projectDir, backup.backupPath) };
}

/** POST: extract the frame under the playhead and fold split + still + shift into one file write. */
export function registerFreezeFrameRoutes(
  api: Hono,
  adapter: StudioApiAdapter,
  extract: FrameExtractor = ffmpegExtractor,
  stillToken: () => string = randomStillToken,
): void {
  // A straight line of request guards, each its own early return.
  // fallow-ignore-next-line complexity
  api.post("/projects/:id/file-mutations/freeze-frame", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (!isFreezeFrameRequest(body)) {
      return c.json({ error: "path, expectedVersion, target and playhead required" }, 400);
    }
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const absPath = pinWithinProject(project.dir, body.path);
    if (!absPath) return c.json({ error: `forbidden path: ${body.path}` }, 403);

    const read = readExpected(absPath, body.expectedVersion);
    if ("error" in read) return c.json({ error: `${read.error}: ${body.path}` }, read.status);
    const before = read.content;

    const source = readFreezeSource(before, body.target, body.playhead);
    if (!source) return c.json({ error: "Move the playhead inside a video clip to freeze" }, 400);
    const still = await extractStill(project.dir, absPath, source, body.playhead, {
      extract,
      stillToken,
    });
    if ("error" in still) return c.json({ error: still.error }, still.status);
    const { imageSrc, stillPath, imagePath } = still;
    const folded = applyFreezeFrameToHtml(before, {
      target: body.target,
      playhead: body.playhead,
      imageSrc,
    });
    const failAndRemoveStill = (error: string, status: 400 | Failure["status"]) => {
      rmSync(imagePath, { force: true });
      return c.json({ error }, status);
    };
    if (!folded) return failAndRemoveStill("Freeze target was not found in the file", 400);
    const written = writeFolded(project.dir, absPath, body.path, before, folded.html, {
      token: body.transactionToken ?? c.req.header("X-Hyperframes-Write-Token"),
    });
    if ("error" in written) return failAndRemoveStill(written.error, written.status);
    const { version, writeToken, backupPath } = written;
    return c.json({
      ok: true,
      path: body.path,
      before,
      after: folded.html,
      version,
      writeToken,
      backupPath,
      freezeId: folded.freezeId,
      imageSrc,
      stillPath,
    });
  });
}
