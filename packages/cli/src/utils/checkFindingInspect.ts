import { realpathSync } from "node:fs";
import type { Page } from "puppeteer-core";
import type { BundleOptions, BundleScriptProvenance } from "@hyperframes/core/compiler";
import type { LiveInspection, PageRunner } from "@hyperframes/inspector/live";
import type { CheckFindingInspect, CheckInspectTarget } from "./checkTypes.js";
import { normalizeErrorMessage } from "./errorMessage.js";
import type { StaticProjectServer } from "./staticProjectServer.js";

export interface FindingInspector {
  /** The HTML to serve in place of the plain check page; undefined when preparing failed. */
  readonly html?: string;
  ready(server: StaticProjectServer): Promise<void>;
  inspect(page: Page, target: CheckInspectTarget): Promise<CheckFindingInspect>;
}

const runnerFor = (page: Page): PageRunner => ({
  run: <A, R>(fn: (arg: A) => R, arg: A) =>
    page.evaluate(fn as (arg: unknown) => R, arg) as Promise<R>,
});

/** Never throws: a failure to prepare becomes every target's `{ error }`. */
export async function prepareFindingInspector(
  projectDir: string,
  bundle: (options: BundleOptions) => Promise<string>,
): Promise<FindingInspector> {
  let live: LiveInspection;
  try {
    const { fingerprint, prepareLiveInspection } = await import("@hyperframes/inspector/live");
    const project = realpathSync(projectDir);
    const sourceVersion = fingerprint(project);
    const provenance: BundleScriptProvenance[] = [];
    const reads = new Set<string>();
    const html = await bundle({
      scriptProvenance: (script) => provenance.push(script),
      onRead: (path) => reads.add(path),
    });
    live = prepareLiveInspection(project, html, provenance, sourceVersion, [...reads]);
  } catch (error) {
    return failedInspector(error);
  }
  let failure: unknown;
  return {
    html: live.html,
    async ready(server) {
      try {
        live.finalizeDocument(await servedIndexHtml(server));
      } catch (error) {
        failure = error;
      }
    },
    async inspect(page, target) {
      if (failure !== undefined) return { error: normalizeErrorMessage(failure) };
      try {
        const report = await live.inspect(runnerFor(page), {
          targets: [target],
          descendants: false,
        });
        if (
          "selector" in target &&
          report.results.some((result) => result.candidates.length + result.candidatesOmitted > 1)
        ) {
          return { error: `ambiguous_selector: ${target.selector} matches multiple elements` };
        }
        return report;
      } catch (error) {
        return { error: normalizeErrorMessage(error) };
      }
    },
  };
}

function failedInspector(error: unknown): FindingInspector {
  const inspect = { error: normalizeErrorMessage(error) };
  return { ready: async () => {}, inspect: async () => inspect };
}

/** The HTML the server answers for `/`, which differs from what it was given (codec map). */
async function servedIndexHtml(server: StaticProjectServer): Promise<string> {
  if (server.answer) {
    const response = await server.answer({ method: "GET", path: "/", headers: {} });
    return response.body.toString("utf8");
  }
  const response = await fetch(server.url);
  if (!response.ok) throw new Error(`check server answered ${response.status} for its page`);
  return response.text();
}
