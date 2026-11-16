// Builds sub-composition preview pages off the request thread; the route keeps the host's transform and media probes.
import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { injectStudioPreviewAugmentations, withPreviewRuntime } from "../routes/preview.js";
import { previewReferences } from "./previewReads.js";
import { injectPreviewVariables } from "./previewVariables.js";
import { withRootImportMap } from "./rootImportMap.js";
import { buildSubCompositionHtml } from "./subComposition.js";
import type { BuildJob, FinishJob, SubCompositionJob } from "./subCompositionBuild.js";

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

parentPort?.on("message", ({ id, job }: { id: number; job: SubCompositionJob }) => {
  try {
    parentPort?.postMessage({ id, result: job.kind === "build" ? build(job) : finish(job) });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
