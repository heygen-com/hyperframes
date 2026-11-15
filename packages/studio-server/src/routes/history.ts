import type { Context, Hono } from "hono";
import type { StudioApiAdapter } from "../types.js";
import { createWriteToken } from "../helpers/fileVersion.js";
import {
  MAX_WINDOW_IDLE_MS,
  UNDO_MODES,
  type HistoryWindow,
  type ProjectHistory,
} from "../history/projectHistory.js";
import type { HistoryWho, HistoryTarget } from "../history/historyLog.js";
import { HistoryBusyError } from "../history/ownerLock.js";

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

/** Studio's write token, so the watcher's echo of an undo reads as Studio's own write. */
function writing(c: Context): { writeToken?: string } {
  const header = c.req.header("X-Hyperframes-Write-Token");
  return header ? { writeToken: createWriteToken(header) } : {};
}

/** An agent names itself (`who: {kind: "agent", name}`); anyone else is the person at Studio. */
function whoOf(body: Record<string, unknown>): HistoryWho {
  const who = body.who as { kind?: unknown; name?: unknown } | undefined;
  const name = text(who?.name);
  return who?.kind === "agent" && name ? { kind: "agent", name } : YOU;
}

/** How long a window or a coalescing claim may wait for its next write; past the cap a timer overflows. */
function idleOf(body: Record<string, unknown>): number | undefined {
  const idleMs = body.idleMs;
  return typeof idleMs === "number" && idleMs > 0
    ? Math.min(idleMs, MAX_WINDOW_IDLE_MS)
    : undefined;
}

/** `{ [path]: version }` from a request body, keeping only string pairs. */
function versionsOf(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const pairs = Object.entries(value).filter(
    (pair): pair is [string, string] => typeof pair[1] === "string",
  );
  return pairs.length ? Object.fromEntries(pairs) : undefined;
}

function targetsOf(value: unknown): HistoryTarget[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const targets = value.flatMap((item) => targetOf(item) ?? []);
  return targets.length ? targets : undefined;
}

function targetOf(item: unknown): HistoryTarget | null {
  if (!item || typeof item !== "object") return null;
  const fields = item as Record<string, unknown>;
  if (typeof fields.file !== "string") return null;
  const target: HistoryTarget = { file: fields.file, ...identityOf(fields) };
  if (!target.id && !target.hfId && !target.selector) return null;
  const name = nameOf(fields.name);
  if (name) target.name = name;
  if (isSelectorIndex(fields.selectorIndex)) target.selectorIndex = fields.selectorIndex;
  return target;
}

function identityOf(
  fields: Record<string, unknown>,
): Pick<HistoryTarget, "id" | "hfId" | "selector"> {
  const identity: Pick<HistoryTarget, "id" | "hfId" | "selector"> = {};
  for (const key of ["id", "hfId", "selector"] as const) {
    const field = fields[key];
    if (typeof field === "string" && field) identity[key] = field;
  }
  return identity;
}

const MAX_TARGET_NAME = 200;

function nameOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, MAX_TARGET_NAME) || undefined;
}

const isSelectorIndex = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** What Cmd+Z or Cmd+Shift+Z would revert next, so Studio can name it on its buttons. */
function nextStep(history: ProjectHistory, direction: "back" | "forward") {
  const target = history.next(direction, YOU);
  if (!target) return null;
  const paths = target.files.map((file) => file.path);
  return { id: target.id, label: target.label, endedAt: target.endedAt, paths };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const FORWARD_DEADLINE_MS = 5_000;

function ownerRoute(c: Context, error: unknown): string | null {
  if (!(error instanceof HistoryBusyError) || !error.url || !URL.canParse(error.url)) return null;
  const owner = new URL(error.url);
  if (owner.protocol !== "http:" || !LOOPBACK.has(owner.hostname)) return null;
  const rest = c.req.path.replace(/^.*?\/projects\/[^/]+\/history/, "");
  return `${owner.href.replace(/\/$/, "")}${rest}${new URL(c.req.url).search}`;
}

async function forward(c: Context, target: string): Promise<Response> {
  const token = c.req.header("X-Hyperframes-Write-Token");
  const reads = c.req.method === "GET" || c.req.method === "HEAD";
  const reply = await fetch(target, {
    method: c.req.method,
    headers: {
      "content-type": c.req.header("content-type") ?? "application/json",
      ...(token && { "X-Hyperframes-Write-Token": token }),
    },
    ...(!reads && { body: await c.req.arrayBuffer() }),
    signal: AbortSignal.timeout(FORWARD_DEADLINE_MS),
  });
  const type = reply.headers.get("content-type") ?? "application/json";
  return new Response(await reply.arrayBuffer(), {
    status: reply.status,
    headers: { "content-type": type },
  });
}

/**
 * Runs `task` on the project's history; no history is a 404, a refusal to open or to act ("no longer kept") a 409.
 * A history another live process owns is that owner's: the request goes to it, so one log keeps every edit.
 */
async function withHistory(
  adapter: StudioApiAdapter,
  c: Context,
  task: (history: ProjectHistory, body: Record<string, unknown>) => Promise<unknown> | unknown,
) {
  try {
    const history = await historyOf(adapter, c);
    if (!history) return c.json({ error: "This project has no history here." }, 404);
    const result = await task(history, await bodyOf(c));
    return result instanceof Response ? result : c.json(result ?? null);
  } catch (error) {
    const target = ownerRoute(c, error);
    const forwarded = target && (await forward(c, target).catch(() => null));
    return (
      forwarded || c.json({ error: error instanceof Error ? error.message : String(error) }, 409)
    );
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
      return { entries, back: nextStep(history, "back"), forward: nextStep(history, "forward") };
    }),
  );
  api.post(`${base}/checkpoint`, (c) =>
    withHistory(adapter, c, async (history) => {
      await history.checkpoint();
      return { ok: true };
    }),
  );
  api.post(`${base}/step`, (c) =>
    withHistory(adapter, c, (history, body) =>
      history.step(body.direction === "forward" ? "forward" : "back", YOU, writing(c)),
    ),
  );
  api.post(`${base}/undo`, (c) =>
    withHistory(adapter, c, (history, body) => {
      const mode = UNDO_MODES.find((known) => known === body.mode);
      return history.undo(text(body.entryId) ?? "", { who: whoOf(body), mode, ...writing(c) });
    }),
  );
  api.post(`${base}/restore`, (c) =>
    withHistory(adapter, c, (history, body) =>
      history.restore(text(body.point) ?? "", whoOf(body), writing(c)),
    ),
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
  api.get(`${base}/blob/:hash`, (c) =>
    withHistory(adapter, c, async (history) => {
      const hash = c.req.param("hash") ?? "";
      const bytes = /^[0-9a-f]{64}$/.test(hash)
        ? await history.readBlob(hash).catch(() => null)
        : null;
      return bytes
        ? c.body(new Uint8Array(bytes))
        : c.json({ error: "That file is not kept in this project's history." }, 404);
    }),
  );
  // Studio records after it writes, under the edit's label; a gesture with no idleMs holds until another key.
  api.post(`${base}/claim`, (c) =>
    withHistory(adapter, c, async (history, body) => {
      const paths = Array.isArray(body.paths) ? body.paths.filter((path) => text(path)) : [];
      const coalesceKey = text(body.coalesceKey) ?? undefined;
      const overwrote = versionsOf(body.overwrote);
      const targets = targetsOf(body.targets);
      const claimed = await history.claim(YOU, text(body.label) ?? "Edited in Studio", paths, {
        ...(coalesceKey && { coalesceKey, idleMs: idleOf(body) ?? Infinity }),
        ...(overwrote && { overwrote }),
        ...(targets && { targets }),
      });
      return { claimed };
    }),
  );
  api.post(`${base}/window`, (c) =>
    withHistory(adapter, c, async (history, body) => {
      const idleMs = idleOf(body);
      const window = await history.beginWindow(
        whoOf(body),
        text(body.label) ?? "Edited in Studio",
        {
          ...(idleMs ? { idleMs } : {}),
          ...(body.exclusive === true && { exclusive: true }),
        },
      );
      windows.set(window.id, { history, window });
      // The window's id is its last entry's id, unless nothing was left after its last part.
      return { windowId: window.id, startedAt: window.startedAt };
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
