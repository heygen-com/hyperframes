import { apiFetch, validatedApiFetch } from "./client";
import {
  ProjectMetaSchema,
  ProjectPresenceResponseSchema,
  HeartbeatResponseSchema,
} from "./schemas";
import { v } from "./validate";
import type { Infer } from "./validate";

export type ProjectMeta = Infer<typeof ProjectMetaSchema>;

export interface PresenceSession {
  sessionId: string;
  filePath?: string;
  line?: number;
  column?: number;
  color?: string;
  lastSeen: number;
}

export interface PresenceHeartbeatBody {
  sessionId: string;
  filePath?: string;
  line?: number;
  column?: number;
  color?: string;
}

export type ProjectPresenceResponse = Infer<typeof ProjectPresenceResponseSchema>;

export const COLLAB_CURSOR_ENABLED = Boolean(
  (globalThis as { __HF_COLLAB_CURSOR_ENABLED?: boolean }).__HF_COLLAB_CURSOR_ENABLED
);

const fetchProjects = validatedApiFetch(v.array(ProjectMetaSchema));
const fetchProject = validatedApiFetch(ProjectMetaSchema);
const fetchPresence = validatedApiFetch(ProjectPresenceResponseSchema);
const fetchHeartbeat = validatedApiFetch(HeartbeatResponseSchema);

export async function listProjects(): Promise<ProjectMeta[]> {
  return fetchProjects("/projects");
}

export async function getProject(id: string): Promise<ProjectMeta> {
  return fetchProject(`/projects/${id}`);
}

export async function uploadProject(
  file: File,
  name: string
): Promise<ProjectMeta> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", name);

  return fetchProject("/projects/upload", {
    method: "POST",
    body: formData,
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/projects/${id}`, { method: "DELETE" });
}

export async function updateElementStart(
  projectId: string,
  elementId: string,
  start: number
): Promise<void> {
  await apiFetch(
    `/projects/${projectId}/elements/${encodeURIComponent(elementId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start }),
    }
  );
}

export async function heartbeatProjectPresence(
  projectId: string,
  body: PresenceHeartbeatBody
): Promise<{ enabled: boolean }> {
  return fetchHeartbeat(`/projects/${projectId}/presence/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getProjectPresence(
  projectId: string
): Promise<ProjectPresenceResponse> {
  return fetchPresence(`/projects/${projectId}/presence`);
}
