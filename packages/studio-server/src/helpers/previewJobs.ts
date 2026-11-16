// The preview build passes that parse the page, run on the build worker (subCompositionWorker.ts).
import { readFileSync } from "node:fs";
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
import type {
  BaseJob,
  BuildJob,
  FinishJob,
  PartsJob,
  SubCompositionJob,
} from "./subCompositionBuild.js";

/** The page with its runtime and the files it names, hf-ids pinned to the source's; null once the file is gone. */
function build(job: BuildJob): { html: string; references: string[] } | null {
  const { projectDir, compPath, compFile, runtimeUrl, baseHref, gsapBaseUrl } = job;
  let pinned: string | undefined;
  if (/\.html?$/i.test(compPath)) {
    try {
      pinned = ensureHfIds(readFileSync(compFile, "utf-8"));
    } catch {
      return null; // removed between the route's stat and this read
    }
  }
  const built = buildSubCompositionHtml(
    projectDir,
    compPath,
    runtimeUrl,
    baseHref,
    pinned,
    gsapBaseUrl,
  );
  if (!built) return null;
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

/** One build job's result, on whichever thread calls it (the build worker, or a test). */
export function runPreviewJob(job: SubCompositionJob) {
  switch (job.kind) {
    case "build":
      return build(job);
    case "base":
      return base(job);
    case "finish":
      return finish(job);
    case "parts":
      return parts(job);
    default:
      return job satisfies never;
  }
}
