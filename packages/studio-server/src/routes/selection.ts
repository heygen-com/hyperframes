import type { Hono } from "hono";
import type {
  StudioApiAdapter,
  StudioSelectionResponse,
  StudioSelectionSnapshot,
} from "../types.js";

interface StoredSelection {
  selection: StudioSelectionSnapshot;
  updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === "string");
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "string";
}

function hasRequiredStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => hasString(value, key));
}

function hasOptionalString(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || typeof value[key] === "string";
}

function hasOptionalNullableString(value: Record<string, unknown>, key: string): boolean {
  return value[key] == null || typeof value[key] === "string";
}

function hasOptionalNumber(value: Record<string, unknown>, key: string): boolean {
  return value[key] === undefined || isFiniteNumber(value[key]);
}

function isBoundingBox(value: unknown): value is StudioSelectionSnapshot["boundingBox"] {
  return (
    isRecord(value) && ["x", "y", "width", "height"].every((key) => isFiniteNumber(value[key]))
  );
}

function isTarget(value: unknown): value is StudioSelectionSnapshot["target"] {
  if (!isRecord(value)) return false;
  return (
    hasOptionalNullableString(value, "id") &&
    hasOptionalString(value, "hfId") &&
    hasOptionalString(value, "selector") &&
    hasOptionalNumber(value, "selectorIndex")
  );
}

function isTextField(value: unknown): value is StudioSelectionSnapshot["textFields"][number] {
  return (
    isRecord(value) &&
    hasRequiredStrings(value, ["key", "label", "value", "tagName"]) &&
    ["self", "child", "text-node"].includes(value.source as string)
  );
}

function isTextFields(value: unknown): value is StudioSelectionSnapshot["textFields"] {
  return Array.isArray(value) && value.every(isTextField);
}

function isSelectionSnapshot(value: unknown): value is StudioSelectionSnapshot {
  if (!isRecord(value)) return false;

  const checks = [
    value.schemaVersion === 1 &&
      hasRequiredStrings(value, [
        "projectId",
        "compositionPath",
        "sourceFile",
        "label",
        "tagName",
        "thumbnailUrl",
      ]),
    isFiniteNumber(value.currentTime),
    isTarget(value.target),
    isBoundingBox(value.boundingBox),
    value.textContent === null || typeof value.textContent === "string",
    isStringRecord(value.dataAttributes),
    isStringRecord(value.inlineStyles),
    isStringRecord(value.computedStyles),
    isTextFields(value.textFields),
    isRecord(value.capabilities),
  ];

  return checks.every(Boolean);
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
    if (!isRecord(body) || !("selection" in body)) {
      return c.json({ error: "missing selection" }, 400);
    }

    if (body.selection === null) {
      selections.delete(project.id);
      return c.json({ ok: true, selection: null, updatedAt: null });
    }

    if (!isSelectionSnapshot(body.selection)) {
      return c.json({ error: "invalid selection" }, 400);
    }

    const selection = { ...body.selection, projectId: project.id };
    const updatedAt = new Date().toISOString();
    selections.set(project.id, { selection, updatedAt });
    return c.json({ ok: true, selection, updatedAt });
  });
}
