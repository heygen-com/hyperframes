import { apiFetch, validatedApiFetch } from "./client";
import { FileContentSchema, FileListResponseSchema } from "./schemas";
import type { Infer } from "./validate";

export type ProjectFile = Infer<typeof FileListResponseSchema>["files"][number];

export type FileContent = Infer<typeof FileContentSchema>;

const fetchFileList = validatedApiFetch(FileListResponseSchema);
const fetchFileContent = validatedApiFetch(FileContentSchema);

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const data = await fetchFileList(`/projects/${projectId}/files`);
  return data.files;
}

export async function getFileContent(projectId: string, filename: string, compiled?: boolean): Promise<FileContent> {
  const qs = compiled ? "?compiled=true" : "";
  return fetchFileContent(`/projects/${projectId}/files/${encodeURIComponent(filename)}${qs}`);
}

export async function saveFileContent(projectId: string, filename: string, content: string): Promise<void> {
  await apiFetch(`/projects/${projectId}/files/${encodeURIComponent(filename)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}
