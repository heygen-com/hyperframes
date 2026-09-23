import { applyPreviewVariablesToUrl } from "../hooks/previewVariablesStore";
import { buildProjectApiPath, parseProjectIdFromHash } from "./projectRouting";

let prefetched: string | null = null;

/** Asks the server for the preview document of the project in the URL while Studio boots, so
 * the build runs in parallel with the app instead of after the player mounts. */
export function prefetchPreviewForHash(hash: string): void {
  const projectId = parseProjectIdFromHash(hash);
  if (!projectId || projectId === prefetched) return;
  prefetched = projectId;
  const url = new URL(buildProjectApiPath(projectId, "/preview"), window.location.origin);
  applyPreviewVariablesToUrl(url);
  // ponytail: the response is dropped; the server keeps the built document for the player's request.
  fetch(url).catch(() => undefined);
}
