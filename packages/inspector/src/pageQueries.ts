import type {
  TimelineEvent,
  TimelineRequest,
  TimelineRuntimeResult,
} from "../../core/src/runtime/timelineInspection";
import type { RuntimeQuery, RuntimeResponse } from "./types";

export interface PageRunner {
  run<A, R>(fn: (arg: A) => R, arg: A): Promise<R>;
}

export interface PageTimeline extends TimelineRuntimeResult {
  following: TimelineEvent[];
  generation: string | null;
  duration?: number;
}

export interface PageRuntimeResponse extends RuntimeResponse {
  generation: string | null;
}

type InspectedWindow = Window & {
  __hfInspection?: {
    query(query: RuntimeQuery): RuntimeResponse;
    timeline(request: TimelineRequest): TimelineRuntimeResult;
  };
  __hfLiveInspection?: { generation: string; project: string };
  __hfHoldScenes?: (names: string[], holder?: string) => Promise<void>;
  __player?: {
    renderSeek(time: number, options: { exact: boolean }): void;
    getTime(): number;
    getDuration(): number;
  };
};

export interface PlayerState {
  time: number | undefined;
  duration: number | undefined;
}

export function seekPage(time: number): void {
  const player = (window as InspectedWindow).__player;
  if (!player) throw new Error("player_unavailable");
  player.renderSeek(time, { exact: true });
}

export function playerStatePage(): PlayerState {
  const player = (window as InspectedWindow).__player;
  return { time: player?.getTime(), duration: player?.getDuration() };
}

export function queryPage(query: RuntimeQuery): PageRuntimeResponse {
  const inspected = window as InspectedWindow;
  const inspection = inspected.__hfInspection;
  if (!inspection) throw new Error("inspector_unavailable");
  return {
    generation: inspected.__hfLiveInspection?.generation ?? null,
    ...inspection.query(query),
  };
}

export function timelinePage(request: TimelineRequest): PageTimeline {
  const inspected = window as InspectedWindow;
  const inspection = inspected.__hfInspection;
  if (!inspection) throw new Error("inspector_unavailable");
  const result = inspection.timeline(request);
  const following: TimelineEvent[] = [];
  const generation = inspected.__hfLiveInspection?.generation ?? null;
  const duration = inspected.__player?.getDuration();
  if (request.boundary === undefined) return { ...result, following, generation, duration };
  const boundary = request.boundary;
  const schedule = inspection.timeline({ ...request, boundary: undefined });
  for (const crossing of result.events) {
    if (crossing.kind !== "animation" || crossing.relation !== "crosses") continue;
    for (const target of crossing.targets) {
      const next = schedule.events
        .filter(
          (event) =>
            event.kind === "animation" &&
            event.start > boundary &&
            event.targets.some((t) => t.ref === target.ref) &&
            event.properties.some((p) => crossing.properties.includes(p)),
        )
        .sort((a, b) => a.start - b.start)[0];
      if (next && !following.includes(next)) following.push(next);
    }
  }
  return { ...result, following, generation, duration };
}

export function liveGenerationPage(): string | null {
  return (window as InspectedWindow).__hfLiveInspection?.generation ?? null;
}

export async function holdEveryScenePage(holder: string): Promise<string[]> {
  const hold = (window as InspectedWindow).__hfHoldScenes;
  if (!hold) return [];
  const sceneOf = (el: Element) => el.getAttribute("data-hf-scene") ?? "";
  const names = new Set(Array.from(document.querySelectorAll("[data-hf-scene]"), sceneOf));
  await hold([...names], holder);
  return Array.from(document.querySelectorAll("[data-hf-parked-scene]"), sceneOf);
}

export async function releaseEveryScenePage(holder: string): Promise<void> {
  await (window as InspectedWindow).__hfHoldScenes?.([], holder);
}
