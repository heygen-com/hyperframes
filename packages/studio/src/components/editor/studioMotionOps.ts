import {
  DEFAULT_CUSTOM_EASE_POINTS,
  GSAP_EASE_CONTROL_POINTS,
  CUSTOM_EASE_DATA_PATTERN,
  STUDIO_MOTION_ATTR,
  type StudioCustomEaseControlPoints,
  type StudioGsapCustomEase,
  type StudioGsapMotionValues,
  type StudioMotionPayload,
} from "./studioMotionTypes";
import { roundTo3 } from "../../utils/rounding";

function clampRange(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── Custom ease points ──

export function clampStudioCustomEasePoints(
  points: Partial<StudioCustomEaseControlPoints>,
): StudioCustomEaseControlPoints {
  return {
    x1: roundTo3(clampRange(points.x1 ?? DEFAULT_CUSTOM_EASE_POINTS.x1, 0, 1, 0.215)),
    y1: roundTo3(clampRange(points.y1 ?? DEFAULT_CUSTOM_EASE_POINTS.y1, -0.6, 1.6, 0.61)),
    x2: roundTo3(clampRange(points.x2 ?? DEFAULT_CUSTOM_EASE_POINTS.x2, 0, 1, 0.355)),
    y2: roundTo3(clampRange(points.y2 ?? DEFAULT_CUSTOM_EASE_POINTS.y2, -0.6, 1.6, 1)),
  };
}

export function parseStudioCustomEaseData(
  data: string | undefined,
): StudioCustomEaseControlPoints | null {
  if (!data) return null;
  const match = data.trim().match(CUSTOM_EASE_DATA_PATTERN);
  if (!match) return null;
  const points = {
    x1: Number.parseFloat(match[1] ?? ""),
    y1: Number.parseFloat(match[2] ?? ""),
    x2: Number.parseFloat(match[3] ?? ""),
    y2: Number.parseFloat(match[4] ?? ""),
  };
  if (!Object.values(points).every(Number.isFinite)) return null;
  return clampStudioCustomEasePoints(points);
}

export function controlPointsForGsapEase(ease: string): StudioCustomEaseControlPoints {
  return GSAP_EASE_CONTROL_POINTS[ease] ?? DEFAULT_CUSTOM_EASE_POINTS;
}

function parseMotionValues(value: unknown): StudioGsapMotionValues | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const parsed: StudioGsapMotionValues = {};
  for (const key of ["x", "y", "scale", "rotation", "opacity", "autoAlpha"] as const) {
    const next = finiteNumber(record[key]);
    if (next != null) parsed[key] = next;
  }
  return Object.keys(parsed).length > 0 ? parsed : null;
}

function parseCustomEase(value: unknown): StudioGsapCustomEase | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const data = typeof record.data === "string" ? record.data.trim() : "";
  if (!id || !data) return undefined;
  return { id, data };
}

export function readStudioMotionFromElement(element: HTMLElement): StudioMotionPayload | null {
  const json = element.getAttribute(STUDIO_MOTION_ATTR);
  if (!json || json === "true") return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const start = finiteNumber(record.start);
    const duration = finiteNumber(record.duration);
    if (start == null || duration == null || start < 0 || duration <= 0) return null;
    const ease =
      typeof record.ease === "string" && record.ease.trim() ? record.ease.trim() : "none";
    const from = parseMotionValues(record.from);
    const to = parseMotionValues(record.to);
    if (!from || !to) return null;
    return { start, duration, ease, customEase: parseCustomEase(record.customEase), from, to };
  } catch {
    return null;
  }
}
