import { buildProjectApiPath } from "./projectRouting";
import { createStudioSaveHttpError } from "./studioSaveDiagnostics";

export async function deleteProjectFile(projectId: string, path: string): Promise<void> {
  const response = await fetch(
    buildProjectApiPath(projectId, `/files/${encodeURIComponent(path)}`),
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw await createStudioSaveHttpError(response, `Failed to delete ${path}`);
  }
}
