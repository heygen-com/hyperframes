// Builds sub-composition preview pages off the server's request thread (subCompositionBuild.ts starts it).
import { readFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { buildSubCompositionHtml } from "./subComposition.js";
import type { SubCompositionJob } from "./subCompositionBuild.js";

/** The page, its raw file's hf-ids pinned first so they match the source's; null once the file is gone. */
function build({
  projectDir,
  compPath,
  compFile,
  runtimeUrl,
  baseHref,
  gsapBaseUrl,
}: SubCompositionJob & {
  kind: "build";
}): string | null {
  let pinned: string | undefined;
  if (/\.html?$/i.test(compPath)) {
    try {
      pinned = ensureHfIds(readFileSync(compFile, "utf-8"));
    } catch {
      return null; // removed between the route's stat and this read
    }
  }
  return buildSubCompositionHtml(projectDir, compPath, runtimeUrl, baseHref, pinned, gsapBaseUrl);
}

parentPort?.on("message", ({ id, job }: { id: number; job: SubCompositionJob }) => {
  try {
    const html = job.kind === "build" ? build(job) : ensureHfIds(job.html);
    parentPort?.postMessage({ id, html });
  } catch (error) {
    parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
