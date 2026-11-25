// The preview build passes that parse the page, run on the build worker (subCompositionWorker.ts).
import { isCompositionTooLargeError } from "@hyperframes/core/compiler/composition-size-limit";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addScenePartsManifest } from "@hyperframes/core/compiler";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import {
  injectStudioPreviewAugmentations,
  withPreviewBase,
  withPreviewRuntime,
} from "../routes/preview.js";
import { previewReferences } from "./previewReads.js";
import { injectPreviewVariables } from "./previewVariables.js";
import { withRootImportMap } from "./rootImportMap.js";
import { buildSubCompositionHtml } from "./subComposition.js";
import { isCompositionSource } from "./hfIdPersist.js";
import type {
  BaseJob,
  BuildJob,
  CompositionsJob,
  FinishJob,
  PartsJob,
  SubCompositionJob,
} from "./subCompositionBuild.js";

/** The page with its runtime and the files it names, hf-ids pinned to the source's; null once the file is gone. */
function buildOrRefuse(buildPage: () => string | null): string | { refused: string } | null {
  try {
    return buildPage();
  } catch (error) {
    if (isCompositionTooLargeError(error)) return { refused: error.message };
    throw error;
  }
}

function build(job: BuildJob): { html: string; references: string[] } | { refused: string } | null {
  const { projectDir, compPath, compFile, runtimeUrl, baseHref, gsapBaseUrl } = job;
  let pinned: string | undefined;
  if (/\.html?$/i.test(compPath)) {
    try {
      pinned = ensureHfIds(readFileSync(compFile, "utf-8"));
    } catch {
      return null; // removed between the route's stat and this read
    }
  }
  const built = buildOrRefuse(() =>
    buildSubCompositionHtml(projectDir, compPath, runtimeUrl, baseHref, pinned, gsapBaseUrl),
  );
  if (typeof built !== "string") return built;
  const html = withPreviewRuntime(withRootImportMap(built, baseHref), runtimeUrl);
  return { html, references: [...previewReferences(html)] };
}

function finish({
  html,
  runtimeUrl,
  signature,
  projectDir,
  compPath,
  options,
  variables,
}: FinishJob): string {
  const augmented = injectStudioPreviewAugmentations(
    ensureHfIds(html),
    runtimeUrl,
    signature,
    projectDir,
    compPath,
    options,
  );
  return variables ? injectPreviewVariables(augmented, variables) : augmented;
}

/** The root page under its base and runtime, with the files it names. */
function base({ html, projectId, runtimeUrl }: BaseJob) {
  const based = withPreviewRuntime(withPreviewBase(html, projectId), runtimeUrl);
  return { html: based, references: [...previewReferences(based)] };
}

const parts = ({ html, ignore }: PartsJob) => addScenePartsManifest(html, ignore);

function isCompositionFile(path: string): boolean {
  try {
    return isCompositionSource(readFileSync(path, "utf-8"));
  } catch {
    return false;
  }
}

function compositions(
  { projectDir, files, keptBackForPageInProgressMs }: CompositionsJob,
  timeLeftMs: number,
) {
  const stop = performance.now() + timeLeftMs - keptBackForPageInProgressMs;
  const found: string[] = [];
  let unchecked = 0;
  for (const file of files) {
    if (performance.now() > stop) unchecked++;
    else if (isCompositionFile(join(projectDir, file))) found.push(file);
  }
  return { compositions: found, unchecked };
}

/** One build job's result, on whichever thread calls it (the build worker, or a test). */
export function runPreviewJob(job: SubCompositionJob, timeLeftMs = Infinity) {
  switch (job.kind) {
    case "build":
      return build(job);
    case "base":
      return base(job);
    case "finish":
      return finish(job);
    case "parts":
      return parts(job);
    case "compositions":
      return compositions(job, timeLeftMs);
    default:
      return job satisfies never;
  }
}
