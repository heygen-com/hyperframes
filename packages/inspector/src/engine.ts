import type { TimelineRequest } from "../../core/src/runtime/timelineInspection";
import { withAuthoredState } from "./authoredState";
import { collectElementDom, formatElementMap, type ElementMap } from "./elementMap.js";
import { mapInspection } from "./mapInspection";
import { queryPage, timelinePage, type PageRunner } from "./pageQueries";
import type { AuthoredHtml, Sources } from "./sources";
import { formatTimeline, type TimelineReport } from "./timelineReport";
import type { InspectRequest, Snippet } from "./types";

export interface SourceContext {
  sources: Sources;
  map: ReturnType<Sources["mapper"]>;
}

export interface InspectionView {
  readonly generation: string;
  readonly sourceVersion: string;
  readonly pageGeneration?: string;
  sourceContext(): SourceContext;
  authoredHtml?(): AuthoredHtml;
  assertCurrent(): Promise<void>;
}

export type ComponentReport = ReturnType<typeof mapInspection>;
export type ElementMapReport = ElementMap & { sourceVersion: string; generation: string };

function assertPageGeneration(view: InspectionView, actual: string | null) {
  if (view.pageGeneration !== undefined && actual !== view.pageGeneration)
    throw new Error("stale_preview: the preview reloaded; query again");
}

export async function inspectComponents(
  runner: PageRunner,
  view: InspectionView,
  request: InspectRequest,
  context: {
    catalog: Map<string, Snippet>;
    reused: boolean;
    start: number;
    visualState?: { time: number | undefined; duration: number | undefined };
  },
): Promise<ComponentReport> {
  const { sources, map } = view.sourceContext();
  const raw = await runner.run(queryPage, {
    targets: request.targets,
    descendants: request.descendants ?? true,
    cssRules: sources.cssRules.map(({ id, selector }) => ({ id, selector })),
  });
  assertPageGeneration(view, raw.generation);
  await view.assertCurrent();
  return mapInspection(raw, request, {
    ...context,
    sources,
    map,
    generation: view.generation,
    sourceVersion: view.sourceVersion,
  });
}

export async function inspectTimeline(
  runner: PageRunner,
  view: InspectionView,
  request: TimelineRequest,
  reused: boolean,
): Promise<TimelineReport> {
  const raw = await runner.run(timelinePage, request);
  assertPageGeneration(view, raw.generation);
  await view.assertCurrent();
  return formatTimeline(raw, request, {
    generation: view.generation,
    map: view.sourceContext().map,
    reused,
  });
}

export async function inspectElementMap(
  runner: PageRunner,
  view: InspectionView,
  file = "index.html",
): Promise<ElementMapReport> {
  const snapshot = await runner.run(collectElementDom, undefined);
  assertPageGeneration(view, snapshot.generation);
  const authored = view.authoredHtml?.();
  const map = formatElementMap(authored ? withAuthoredState(snapshot, authored) : snapshot, {
    file,
  });
  await view.assertCurrent();
  return { ...map, sourceVersion: view.sourceVersion, generation: view.generation };
}

export type { PageRunner, TimelineReport };
