import type { TimelineRequest } from "../../core/src/runtime/timelineInspection";
import type { InspectRequest } from "./types";

export function validateInspectRequest(request: InspectRequest): void {
  if (
    !Array.isArray(request.targets) ||
    request.targets.length > 20 ||
    (!request.targets.length && !request.snippets?.length)
  )
    throw new Error("Provide 1–20 targets, or snippet IDs from a previous query.");
  for (const target of request.targets) {
    if (!target || typeof target !== "object") throw new Error("Invalid target");
    const keys = ["selector", "hfId", "ref"].filter((key) => key in target);
    if (
      keys.length !== 1 ||
      Object.values(target).some(
        (value) => typeof value !== "string" || !value || value.length > 1000,
      )
    )
      throw new Error("Each target needs exactly one selector, hfId or ref; within is optional.");
  }
  const maxBytes = request.maxBytes ?? 12_000;
  if (!Number.isInteger(maxBytes) || maxBytes < 2048 || maxBytes > 256_000)
    throw new Error("maxBytes must be 2048–256000");
  if (request.time != null && (!Number.isFinite(request.time) || request.time < 0))
    throw new Error("time must be a finite non-negative number");
  if (request.snippets?.length && !request.generation)
    throw new Error("snippet continuation requires generation");
}

const TIMELINE_KEYS = ["component", "at", "range", "boundary", "generation", "offset"];
const COMPONENT_KEYS = ["selector", "hfId", "ref", "within"];

export function validateTimelineRequest(request: TimelineRequest): void {
  if (!request || typeof request !== "object" || Array.isArray(request))
    throw new Error("Expected query object");
  if (Object.keys(request).some((key) => !TIMELINE_KEYS.includes(key)))
    throw new Error("Unknown timeline query parameter");
  const times = [request.at, request.range, request.boundary].filter((v) => v !== undefined);
  if (times.length > 1) throw new Error("at, range and boundary are mutually exclusive");
  const numbers = [
    request.at,
    request.boundary,
    ...(Array.isArray(request.range) ? request.range : []),
  ].filter((v) => v !== undefined);
  if (numbers.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0))
    throw new Error("Times must be finite non-negative seconds");
  if (
    request.range !== undefined &&
    (!Array.isArray(request.range) ||
      request.range.length !== 2 ||
      request.range[0] >= request.range[1])
  )
    throw new Error("range must be [start,end] with start < end");
  const component = request.component;
  if (
    component &&
    (typeof component !== "object" ||
      Object.keys(component).some((key) => !COMPONENT_KEYS.includes(key)) ||
      ["selector", "hfId", "ref"].filter((key) => key in component).length !== 1 ||
      Object.values(component).some((v) => typeof v !== "string" || !v))
  )
    throw new Error("component requires one selector, hfId or ref");
  const offset = request.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0)
    throw new Error("offset must be non-negative integer");
  if (offset && !request.generation) throw new Error("pagination requires generation");
}

export function assertGeneration(requested: string | undefined, current: string): void {
  if (requested && requested !== current)
    throw new Error("stale_generation: query targets again after source changes or idle disposal");
}
