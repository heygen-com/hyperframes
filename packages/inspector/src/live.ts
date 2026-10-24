import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import type { BundleScriptProvenance } from "../../core/src/compiler/htmlBundler";
import type { TimelineRequest } from "../../core/src/runtime/timelineInspection";
import {
  inspectComponents,
  inspectElementMap,
  inspectTimeline,
  type ComponentReport,
  type ElementMapReport,
  type InspectionView,
  type SourceContext,
  type TimelineReport,
} from "./engine";
import { liveGenerationPage, type PageRunner } from "./pageQueries";
import { assertGeneration, validateInspectRequest, validateTimelineRequest } from "./requests";
import {
  Sources,
  authoredHtml,
  fingerprint as sourceFingerprint,
  type AuthoredHtml,
} from "./sources";
import type { InspectRequest, Snippet } from "./types";

export interface LiveInspection {
  readonly html: string;
  readonly generation: string;
  finalizeDocument(servedHtml: string): void;
  inspect(runner: PageRunner, request: InspectRequest): Promise<ComponentReport>;
  timeline(runner: PageRunner, request: TimelineRequest): Promise<TimelineReport>;
  elementMap(runner: PageRunner): Promise<ElementMapReport>;
}

const runtime = () => readFileSync(new URL(`./inspection.${"js"}`, import.meta.url), "utf8");
export function prepareLiveInspection(
  projectDir: string,
  html: string,
  provenance: readonly BundleScriptProvenance[],
  sourceVersion: string,
  reads?: readonly string[],
): LiveInspection {
  const project = realpathSync(projectDir);
  if (fingerprint(project) !== sourceVersion) throw new Error("source_changed_during_load");
  if (!/<head\b[^>]*>/i.test(html)) throw new Error("preview_head_missing");
  const generation = randomUUID();
  const stamp = `window.__hfLiveInspection=${JSON.stringify({ generation, project })};`;
  const script = `${stamp}\n${runtime()}`.replace(/<\/script/gi, "<\\/script");
  const prepared = html.replace(/<head\b[^>]*>/i, (head) => `${head}<script>${script}</script>`);
  let document = prepared;
  let context: SourceContext | undefined;
  let authored: AuthoredHtml | undefined;
  const catalog = new Map<string, Snippet>();
  const view: InspectionView = {
    generation,
    sourceVersion,
    pageGeneration: generation,
    sourceContext() {
      if (!context) {
        const sources = new Sources(project, reads);
        context = { sources, map: sources.mapper(document, [...provenance]) };
      }
      return context;
    },
    authoredHtml() {
      return (authored ??= authoredHtml(project));
    },
    async assertCurrent() {
      if (fingerprint(project) !== sourceVersion)
        throw new Error("stale_preview: the project changed; query again once the preview reloads");
    },
  };
  async function current(runner: PageRunner): Promise<void> {
    if ((await previewGeneration(runner)) !== generation)
      throw new Error("stale_preview: the preview reloaded; query again");
    await view.assertCurrent();
  }
  return {
    html: prepared,
    generation,
    finalizeDocument(servedHtml) {
      document = servedHtml;
      context = undefined;
    },
    async inspect(runner, request) {
      validateInspectRequest(request);
      if (request.time != null) throw new Error("live_query_does_not_seek");
      assertGeneration(request.generation, generation);
      await current(runner);
      return inspectComponents(runner, view, request, {
        catalog,
        reused: true,
        start: performance.now(),
      });
    },
    async timeline(runner, request) {
      validateTimelineRequest(request);
      assertGeneration(request.generation, generation);
      await current(runner);
      return inspectTimeline(runner, view, request, true);
    },
    async elementMap(runner) {
      await current(runner);
      return inspectElementMap(runner, view);
    },
  };
}

export function previewGeneration(runner: PageRunner): Promise<string | null> {
  return runner.run(liveGenerationPage, undefined);
}

export function fingerprint(project: string) {
  return sourceFingerprint(project, { ignoreHfIds: true });
}
export type {
  ComponentReport,
  ElementMapReport,
  InspectRequest,
  PageRunner,
  TimelineReport,
  TimelineRequest,
};
