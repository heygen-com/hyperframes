import type { Context, Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import type { HistoryWindow, ProjectHistory } from "../history/projectHistory.js";
import type { HistoryWho } from "../history/historyLog.js";

const YOU: HistoryWho = { kind: "person", name: "You" };

async function historyOf(adapter: StudioApiAdapter, c: Context): Promise<ProjectHistory | null> {
  const project = await adapter.resolveProject(c.req.param("id") ?? "");
  return project ? ((await adapter.history?.(project)) ?? null) : null;
}

async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/** Runs `task` on the project's history; no history is a 404, an engine refusal ("no longer kept") a 409. */
async function withHistory(
  adapter: StudioApiAdapter,
  c: Context,
  task: (history: ProjectHistory, body: Record<string, unknown>) => Promise<unknown> | unknown,
) {
  const history = await historyOf(adapter, c);
  if (!history) return c.json({ error: "This project has no history here." }, 404);
  try {
    return c.json((await task(history, await bodyOf(c))) ?? null);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
  }
}

/** Studio's history: list, Cmd+Z and Shift+Z, undo with the conflict choice, restore, peek, pin, edit windows. */
export function registerHistoryRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // ponytail: a window whose close never arrives stays open until the server stops.
  const windows = new Map<string, HistoryWindow>();
  const base = "/projects/:id/history";

  api.get(base, (c) => withHistory(adapter, c, (history) => ({ entries: history.list() })));
  api.post(`${base}/step`, (c) =>
    withHistory(adapter, c, (history, body) =>
      history.step(body.direction === "forward" ? "forward" : "back", YOU),
    ),
  );
  api.post(`${base}/undo`, (c) =>
    withHistory(adapter, c, (history, body) => {
      const mode =
        body.mode === "just-this" || body.mode === "back-to-before" ? body.mode : undefined;
      return history.undo(text(body.entryId) ?? "", { who: YOU, mode });
    }),
  );
  api.post(`${base}/restore`, (c) =>
    withHistory(adapter, c, (history, body) => history.restore(text(body.point) ?? "", YOU)),
  );
  api.get(`${base}/peek/:point`, (c) =>
    withHistory(adapter, c, (history) => ({ files: history.peek(c.req.param("point")) })),
  );
  api.post(`${base}/pin`, (c) =>
    withHistory(adapter, c, (history, body) => {
      history.pin(text(body.entryId) ?? "", body.pinned === true);
      return { ok: true };
    }),
  );
  api.post(`${base}/window`, (c) =>
    withHistory(adapter, c, async (history, body) => {
      const window = await history.beginWindow(YOU, text(body.label) ?? "Edited in Studio");
      windows.set(window.id, window);
      return { windowId: window.id };
    }),
  );
  api.post(`${base}/window/:windowId/close`, (c) =>
    withHistory(adapter, c, async () => {
      const window = windows.get(c.req.param("windowId") ?? "");
      windows.delete(c.req.param("windowId") ?? "");
      return { entry: window ? await window.close() : null };
    }),
  );
}
