import { appendFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

const TOOL_CONTEXT_VERSION = 1;

export interface ToolContext {
  events?: { path: string };
  projectLock?: { waitMs: number };
  checkReview?: { skipContrastInMotion: boolean; findingFrames: boolean; inspect: boolean };
}

export type ArtifactRole = "contact-sheet" | "frame" | "finding" | "check-report";

interface ArtifactCreatedEvent {
  version: typeof TOOL_CONTEXT_VERSION;
  type: "artifact.created";
  command: string;
  artifact: { role: ArtifactRole; path: string; mediaType: string };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseEvents(value: unknown): ToolContext["events"] {
  if (!isRecord(value) || !isRecord(value.transport)) return undefined;
  const { type, path } = value.transport;
  if (type !== "ndjson-file" || typeof path !== "string" || !isAbsolute(path)) return undefined;
  return { path };
}

function parseProjectLock(value: unknown): ToolContext["projectLock"] {
  if (!isRecord(value)) return undefined;
  const { waitMs } = value;
  if (typeof waitMs !== "number" || !Number.isFinite(waitMs) || waitMs < 0) return undefined;
  return { waitMs };
}

function parseCheckReview(value: unknown): ToolContext["checkReview"] {
  if (!isRecord(value)) return undefined;
  return {
    skipContrastInMotion: value.skipContrastInMotion === true,
    findingFrames: value.findingFrames === true,
    inspect: value.inspect === true,
  };
}

export function readToolContext(raw = process.env.HF_TOOL_CONTEXT): ToolContext {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(value) || value.version !== TOOL_CONTEXT_VERSION || !isRecord(value.capabilities))
    return {};
  const events = parseEvents(value.capabilities.events);
  const projectLock = parseProjectLock(value.capabilities["project-lock"]);
  const checkReview = parseCheckReview(value.capabilities["check-review"]);
  return {
    ...(events && { events }),
    ...(projectLock && { projectLock }),
    ...(checkReview && { checkReview }),
  };
}

const MEDIA_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
};

export function reportArtifacts(
  command: string,
  role: ArtifactRole,
  paths: readonly string[],
  context = readToolContext(),
): void {
  if (!context.events || paths.length === 0) return;
  const lines = paths.map((path) => {
    const absolute = resolve(path);
    const event: ArtifactCreatedEvent = {
      version: TOOL_CONTEXT_VERSION,
      type: "artifact.created",
      command,
      artifact: {
        role,
        path: absolute,
        mediaType: MEDIA_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
      },
    };
    return JSON.stringify(event) + "\n";
  });
  try {
    appendFileSync(context.events.path, lines.join(""));
  } catch (error) {
    console.error(`HF_TOOL_CONTEXT events could not be written: ${(error as Error).message}`);
  }
}
