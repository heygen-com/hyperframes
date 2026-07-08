import type { AnimationRuntimeEngine } from "./animationRuntimeDetection.js";
import type { AnimeJsPropertyGroupName } from "./animejsConstants.js";

export type AnimeJsMethod = "animate" | "add" | "set" | "label";
export type AnimeJsPrimitive = number | string | boolean;
export type AnimeJsRawValue = `__raw:${string}`;
export type AnimeJsPropertyValue = AnimeJsPrimitive | AnimeJsPrimitive[] | AnimeJsRawValue;
export type AnimeJsProvenanceKind = "literal" | "helper" | "loop" | "runtime-dynamic";
export type AnimeJsKeyframeEditability = "direct" | "unroll" | "source";

export interface AnimeJsProvenance {
  kind: AnimeJsProvenanceKind;
  fn?: string;
  callSite?: number;
  iteration?: number;
  sourceRange?: [number, number];
}

export interface AnimeJsPropertyKeyframe {
  from?: AnimeJsPrimitive;
  to?: AnimeJsPrimitive;
  duration?: number;
  ease?: string;
  delay?: number;
  extras?: Record<string, unknown>;
}

export interface AnimeJsAnimation {
  engine: AnimationRuntimeEngine;
  id: string;
  targetSelector: string;
  targets: string[];
  method: AnimeJsMethod;
  position: number | string;
  properties: Record<string, AnimeJsPropertyValue>;
  propertyKeyframes?: Record<string, AnimeJsPropertyKeyframe[]>;
  duration?: number | string;
  ease?: string;
  delay?: number | string;
  label?: string;
  extras?: Record<string, unknown>;
  registered?: boolean;
  hasUnresolvedSelector?: boolean;
  hasUnresolvedProperties?: boolean;
  resolvedStart?: number;
  implicitPosition?: boolean;
  propertyGroup?: AnimeJsPropertyGroupName;
  provenance?: AnimeJsProvenance;
}

export interface ParsedAnimeJs {
  engine: AnimationRuntimeEngine;
  animations: AnimeJsAnimation[];
  timelineVar: string;
  preamble: string;
  postamble: string;
  labels: Record<string, number>;
  registered: boolean;
  registrationIds: string[];
  multipleTimelines?: boolean;
  unsupportedTimelinePattern?: boolean;
}

export interface AnimeJsAnimationForInsert {
  targetSelector: string;
  method: "add" | "set" | "animate";
  position?: number | string;
  properties: Record<string, AnimeJsPropertyValue>;
  duration?: number | string;
  ease?: string;
  delay?: number | string;
  extras?: Record<string, unknown>;
}

export function editabilityForAnimeJsProvenance(
  provenance?: AnimeJsProvenance,
): AnimeJsKeyframeEditability {
  if (!provenance || provenance.kind === "literal") return "direct";
  if (provenance.kind === "runtime-dynamic") return "source";
  return "unroll";
}
