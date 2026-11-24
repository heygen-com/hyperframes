import { studioApiFetch } from "../utils/studioApiFetch";

export async function getHyperframeRuntimeScript(): Promise<string> {
  const response = await studioApiFetch("/api/runtime.js");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
