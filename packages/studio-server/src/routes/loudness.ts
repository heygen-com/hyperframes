import { existsSync } from "node:fs";
import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import {
  absoluteLoudnessPlan,
  DEFAULT_TARGET_LUFS,
  measureAudio,
  requiredFfmpeg,
  resolveLocalAudioPath,
  type LoudnessMeasurement,
  type MeasuredWindow,
} from "../helpers/loudness.js";

export type MeasureLoudness = (
  file: string,
  window: MeasuredWindow,
) => Promise<LoudnessMeasurement>;

interface NormalizeRequest {
  id: string;
  src: string;
  window: MeasuredWindow;
  volume: number;
  targetLufs: number;
}

const defaultMeasure: MeasureLoudness = (file, window) =>
  measureAudio(requiredFfmpeg(), file, window);

class InvalidField extends Error {}

function numberField(
  body: Record<string, unknown>,
  name: string,
  fallback: number,
  valid: (value: number) => boolean,
): number {
  const raw = body[name];
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === "number" && Number.isFinite(raw) && valid(raw)) return raw;
  throw new InvalidField(`${name} is out of range`);
}

function readNormalizeRequest(body: Record<string, unknown>): NormalizeRequest {
  const src = typeof body.src === "string" ? body.src.trim() : "";
  if (!src) throw new InvalidField("src is required");
  const duration = numberField(body, "duration", 0, (v) => v > 0);
  return {
    id: typeof body.id === "string" && body.id ? body.id : src,
    src,
    window: {
      mediaStart: numberField(body, "mediaStart", 0, (v) => v >= 0),
      duration: duration > 0 ? duration : null,
      playbackRate: numberField(body, "playbackRate", 1, (v) => v > 0),
    },
    volume: numberField(body, "volume", 1, (v) => v >= 0),
    targetLufs: numberField(body, "targetLufs", DEFAULT_TARGET_LUFS, (v) => v < 0),
  };
}

function parseNormalizeRequest(body: Record<string, unknown>): NormalizeRequest | string {
  try {
    return readNormalizeRequest(body);
  } catch (error) {
    if (error instanceof InvalidField) return error.message;
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Measure one clip's played window and answer the `data-volume` that brings it
 * to the target. Measure-only: Studio writes the attribute through its own
 * edit path so the change is one undo step like any other.
 */
export function registerLoudnessRoutes(
  api: Hono,
  adapter: StudioApiAdapter,
  measure: MeasureLoudness = defaultMeasure,
): void {
  api.post("/projects/:id/loudness/normalize", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const body: unknown = await c.req.json().catch(() => null);
    if (!isRecord(body)) return c.json({ error: "invalid body" }, 400);
    const request = parseNormalizeRequest(body);
    if (typeof request === "string") return c.json({ error: request }, 400);

    let file: string;
    try {
      file = resolveLocalAudioPath(project.dir, request.src);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (!existsSync(file)) return c.json({ error: "file not found" }, 404);

    try {
      const measurement = await measure(file, request.window);
      const plan = absoluteLoudnessPlan(
        { id: request.id, volume: request.volume, ...measurement },
        request.targetLufs,
      );
      return c.json({ plan });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 422);
    }
  });
}
