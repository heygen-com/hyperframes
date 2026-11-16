import { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { registerRecoveryDraftRoutes } from "./recoveryDrafts.js";

const [dir, ...files] = process.argv.slice(2);
const api = new Hono();
registerRecoveryDraftRoutes(api, {
  resolveProject: async (id: string) => (id === "demo" ? { id, dir, title: "Demo" } : null),
} as unknown as StudioApiAdapter);
for (const file of files) {
  const res = await api.request(`/projects/demo/recovery-drafts/${encodeURIComponent(file)}`);
  console.log(JSON.stringify({ file, status: res.status, draft: (await res.json()).draft }));
}
