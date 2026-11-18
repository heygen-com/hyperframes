import { lstatSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { basename, dirname } from "node:path";
import type { RenderJobState } from "../types.js";
import {
  directoryRenderFacts,
  RENDER_FILE_EXTENSIONS,
  RENDER_FILE_PATTERN,
} from "./renderHistory.js";
import { RenderIdentityError, renderFamilyKey, type RenderOwner } from "./renderIdentityStore.js";
import { isLinkFreeWithinProject, realFilePath, resolveWithinProject } from "./safePath.js";

export function checkedRenderOutput(owner: RenderOwner): string {
  const path = resolveWithinProject(owner.root, owner.output);
  if (!path || !isLinkFreeWithinProject(owner.root, join(owner.root, owner.output))) {
    throw new RenderIdentityError("forbidden", 403);
  }
  return path;
}

export function renderJobFamily(job: RenderJobState): string | null {
  if (!job.outputPath) return null;
  return renderFamilyKey({
    root: realFilePath(dirname(job.outputPath)),
    output: basename(job.outputPath),
    kind: job.kind ?? "file",
  });
}

export function buildRenderDeletionPlan(
  owner: RenderOwner,
  jobs: Iterable<RenderJobState>,
  cancelling: ReadonlySet<RenderJobState>,
) {
  const family = renderFamilyKey(owner);
  for (const job of jobs) {
    if ((job.status === "rendering" || cancelling.has(job)) && renderJobFamily(job) === family) {
      throw new RenderIdentityError("render in progress; cancel it first", 409);
    }
  }
  checkedRenderOutput(owner);
  const stem =
    owner.kind === "directory" ? owner.output : owner.output.replace(RENDER_FILE_PATTERN, "");
  const names =
    owner.kind === "directory"
      ? [owner.output]
      : RENDER_FILE_EXTENSIONS.map((ext) => `${stem}${ext}`);
  const candidates = [...names, `${stem}.meta.json`].map((name) => {
    const path = checkedRenderOutput({ ...owner, output: name });
    const stat = lstatSync(path, { throwIfNoEntry: false });
    const directory = owner.kind === "directory" && name === owner.output;
    if (stat && (directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new RenderIdentityError("Render target changed; refresh render history", 409);
    }
    if (stat && directory && !directoryRenderFacts(owner.root, owner.output)) {
      throw new RenderIdentityError(
        "Directory no longer qualifies as a render; refresh render history",
        409,
      );
    }
    return { path, directory, exists: stat !== undefined };
  });
  return {
    owner,
    family,
    remove() {
      for (const candidate of candidates) {
        if (!candidate.exists) continue;
        if (candidate.directory) rmSync(candidate.path, { recursive: true, force: true });
        else unlinkSync(candidate.path);
      }
    },
  };
}
