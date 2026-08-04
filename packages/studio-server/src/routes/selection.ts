import type { Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import {
  studioSelectionRequestSchema,
  type StudioSelectionResponse,
  type StudioSelectionSnapshot,
} from "../helpers/selectionSchema.js";

interface StoredSelection {
  selection: StudioSelectionSnapshot;
  updatedAt: string;
}

export function registerSelectionRoutes(api: Hono, adapter: StudioApiAdapter): void {
  const selections = new Map<string, StoredSelection>();

  api.get("/projects/:id/selection", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);
    const stored = selections.get(project.id);
    return c.json({
      selection: stored?.selection ?? null,
      updatedAt: stored?.updatedAt ?? null,
    } satisfies StudioSelectionResponse);
  });

  api.put("/projects/:id/selection", async (c) => {
    const project = await adapter.resolveProject(c.req.param("id"));
    if (!project) return c.json({ error: "not found" }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }

    const parsed = studioSelectionRequestSchema.safeParse(body);
    if (!parsed.success) {
      // Distinguish "no selection field at all" from "a selection we can't
      // trust": the client fixes those two in different places.
      const missing = !(typeof body === "object" && body !== null && "selection" in body);
      return c.json({ error: missing ? "missing selection" : "invalid selection" }, 400);
    }

    if (parsed.data.selection === null) {
      selections.delete(project.id);
      return c.json({ ok: true, selection: null, updatedAt: null });
    }

    const selection = { ...parsed.data.selection, projectId: project.id };
    const updatedAt = new Date().toISOString();
    selections.set(project.id, { selection, updatedAt });
    return c.json({ ok: true, selection, updatedAt });
  });
}
