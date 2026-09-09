import { buildProjectApiPath } from "../../utils/projectRouting";

export async function probeSourceElement(
  projectId: string,
  sourceFile: string,
  target: { id?: string; hfId?: string; selector?: string; selectorIndex?: number },
): Promise<boolean> {
  try {
    const response = await fetch(
      buildProjectApiPath(
        projectId,
        `/file-mutations/probe-element/${encodeURIComponent(sourceFile)}`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      },
    );
    if (!response.ok) return true;
    const data = await response.json();
    if (data && typeof data === "object" && "exists" in data && data.exists === false) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}
