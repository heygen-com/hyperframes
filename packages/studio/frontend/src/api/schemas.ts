import { v } from "./validate";

// ── Project schemas ─────────────────────────────────────────────────────────

export const ProjectMetaSchema = v.object({
  id: v.string(),
  name: v.string(),
  createdAt: v.string(),
  width: v.number().nullable().optional(),
  height: v.number().nullable().optional(),
});

export const PresenceSessionSchema = v.object({
  sessionId: v.string(),
  filePath: v.string().optional(),
  line: v.number().optional(),
  column: v.number().optional(),
  color: v.string().optional(),
  lastSeen: v.number(),
});

export const ProjectPresenceResponseSchema = v.object({
  enabled: v.boolean(),
  ttlMs: v.number(),
  sessions: v.array(PresenceSessionSchema),
});

export const HeartbeatResponseSchema = v.object({
  enabled: v.boolean(),
});

// ── File schemas ────────────────────────────────────────────────────────────

export const ProjectFileSchema = v.object({
  filename: v.string(),
  language: v.string(),
  size: v.number(),
});

export const FileContentSchema = v.object({
  filename: v.string(),
  language: v.string(),
  content: v.string(),
});

export const FileListResponseSchema = v.object({
  files: v.array(ProjectFileSchema),
});

// ── Render schemas ──────────────────────────────────────────────────────────

export const StartRenderResponseSchema = v.object({
  jobId: v.string(),
  status: v.string(),
});

export const RenderProgressSchema = v.object({
  status: v.enum(["queued", "rendering", "complete", "failed"]),
  progress: v.number(),
  stage: v.string(),
  error: v.string().optional(),
  elapsed: v.number(),
});
