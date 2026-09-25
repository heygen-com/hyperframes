import type { Context, Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import type { HistoryWindow, ProjectHistory } from "../history/projectHistory.js";
import { stepTarget, type HistoryEntry, type HistoryWho } from "../history/historyLog.js";

const YOU: HistoryWho = { kind: "person", name: "You" };
/** No edit waits this long between writes. */
const MAX_WINDOW_IDLE_MS = 10 * 60_000;

async function historyOf(adapter: StudioApiAdapter, c: Context): Promise<ProjectHistory | null> {
  const project = await adapter.resolveProject(c.req.param("id") ?? "");
  return project ? ((await adapter.history?.(project)) ?? null) : null;
}

async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

/** How long a window or a coalescing claim may wait for its next write; past the cap a timer overflows. */
function idleOf(body: Record<string, unknown>): number | undefined {
  const idleMs = body.idleMs;
  return typeof idleMs === "number" && idleMs > 0
    ? Math.min(idleMs, MAX_WINDOW_IDLE_MS)
    : undefined;
}

/** What Cmd+Z or Cmd+Shift+Z would revert next, so Studio can name it on its buttons. */
function nextStep(entries: readonly HistoryEntry[], direction: "back" | "forward") {
  const target = stepTarget(entries, direction);
  if (!target) return null;
  const paths = target.files.map((file) => file.path);
  return { id: target.id, label: target.label, endedAt: target.endedAt, paths };
}

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
  // ponytail: a window whose close never arrives ends itself when idle; its entry here stays until the server stops.
  const windows = new Map<string, { history: ProjectHistory; window: HistoryWindow }>();
  const base = "/projects/:id/history";

  api.get(base, (c) =>
    withHistory(adapter, c, (history) => {
      const entries = history.list();
      return { entries, back: nextStep(entries, "back"), forward: nextStep(entries, "forward") };
    }),
  );
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
  // Studio records after it writes: its edit claims the paths it just wrote, under the edit's label.
  api.post(`${base}/claim`, (c) =>
    withHistory(adapter, c, async (history, body) => {
      const paths = Array.isArray(body.paths) ? body.paths.filter((path) => text(path)) : [];
      const coalesceKey = text(body.coalesceKey) ?? undefined;
      const idleMs = idleOf(body);
      const claimed = await history.claim(YOU, text(body.label) ?? "Edited in Studio", paths, {
        ...(coalesceKey && { coalesceKey }),
        ...(idleMs && { idleMs }),
      });
      return { claimed };
    }),
  );
  api.post(`${base}/window`, (c) =>
    withHistory(adapter, c, async (history, body) => {
      // A drag's burst of writes keeps one window open; it ends itself after idleMs without a write.
      const idleMs = idleOf(body);
      const window = await history.beginWindow(
        YOU,
        text(body.label) ?? "Edited in Studio",
        idleMs ? { idleMs } : undefined,
      );
      windows.set(window.id, { history, window });
      // The window's id is the id of the entry it becomes.
      return { windowId: window.id };
    }),
  );
  api.post(`${base}/window/:windowId/close`, (c) =>
    withHistory(adapter, c, async (history) => {
      const id = c.req.param("windowId") ?? "";
      const held = windows.get(id);
      if (held?.history !== history) throw new Error("That window is not open in this project.");
      windows.delete(id);
      return { entry: await held.window.close() };
    }),
  );
}
