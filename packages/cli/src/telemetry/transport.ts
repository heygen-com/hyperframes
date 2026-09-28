import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { POSTHOG_API_KEY } from "./posthogKey.js";
import { readConfig } from "./config.js";
import { hostAnswers } from "../utils/hostAnswers.js";

// This is a public project API key — safe to embed in client-side code.
// It only allows writing events, not reading data.

const POSTHOG_HOST = "https://us.i.posthog.com";
const FLUSH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Lightweight PostHog transport — talks to the HTTP batch API directly to
// avoid pulling in the full posthog-node SDK and its dependencies. Owns the
// in-memory event queue and the two delivery paths: the async `flush()` used
// during a live process, and the exit-time `flushSync()` that hands the queue
// to a detached child which outlives the parent.
//
// This is the reliability-critical layer — telemetry must never break the CLI,
// and events must survive the render command's abrupt `process.exit()` teardown
// (see `flush()` for the exit-race that made this subtle). The CLI-facing policy
// (opt-out, system-metadata enrichment, first-run notice) lives in client.ts.
// ---------------------------------------------------------------------------

// Scalars cover almost every event. String arrays and numeric maps are allowed
// too because some facts are inherently a set (which lint rule codes fired) or
// a histogram (how many findings per code), and flattening those into dynamic
// top-level keys would make them unqueryable. PostHog stores both natively:
// `arrayJoin(properties.codes)` for the array, `JSONExtractInt` for the map.
export type EventPropertyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[]
  | Readonly<Record<string, number>>;

export interface EventProperties {
  [key: string]: EventPropertyValue;
}

interface QueuedEvent {
  // Client-generated event id. PostHog dedupes on it, so an event that gets
  // sent by an interrupted flush() AND re-sent by the exit-time flushSync()
  // fallback still counts once.
  uuid: string;
  event: string;
  properties: EventProperties;
  timestamp: string;
  // Override for the batch distinct_id. Defaults to the install's anonymousId.
  // Used to attribute server-side studio renders to the browser user who
  // triggered them, so the render funnel is joinable across processes.
  distinctId?: string;
}

let eventQueue: QueuedEvent[] = [];

/**
 * Append an event to the in-memory queue, stamping it with a client-generated
 * `uuid` (PostHog's dedup key) and an ISO timestamp. Non-blocking; the caller
 * is responsible for enrichment (system metadata, cli_version, …).
 */
export function enqueue(event: string, properties: EventProperties, distinctId?: string): void {
  eventQueue.push({
    uuid: randomUUID(),
    event,
    distinctId,
    properties,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Serialize events into a PostHog `/batch/` payload string. Pure — the queue
 * is untouched, so callers decide when events count as delivered.
 *
 * Each event carries its client-generated `uuid`, which PostHog treats as the
 * event id — re-sending the same event is idempotent, not a duplicate.
 *
 * $ip:null tells PostHog not to record the request IP for any of these events.
 * Server-side "Discard client IP data" is also enabled in project settings.
 */
function buildPayload(events: readonly QueuedEvent[]): string | null {
  if (events.length === 0) return null;
  const config = readConfig();
  const batch = events.map((e) => ({
    uuid: e.uuid,
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: e.distinctId ?? config.anonymousId,
    timestamp: e.timestamp,
  }));
  return JSON.stringify({ api_key: POSTHOG_API_KEY, batch });
}

let inFlight: Promise<boolean> | undefined;

/**
 * Flush all queued events to PostHog via async HTTP POST.
 * Call sites: eager sends right after high-value events (trackRenderComplete /
 * trackRenderError), which also serve long-lived preview processes.
 *
 * Events are only removed from the queue once the request has completed.
 * The old drain-first version silently lost the whole batch whenever the
 * process died with the fetch in flight — which is the NORMAL exit path for
 * `render`: an agent pipe closing triggers the EPIPE `process.exit(0)`, and
 * error paths call `process.exit(1)` directly, both killing the in-flight
 * request that `beforeExit` had just started. Keeping the queue intact until
 * delivery lets the exit-time flushSync() child (which survives the parent)
 * re-send anything unconfirmed; event uuids make that re-send idempotent.
 */
export async function flush(): Promise<void> {
  // One request at a time; one queued behind a failed send leaves the batch to flushSync().
  const run = inFlight
    ? inFlight.then((sent) => (sent ? sendQueued() : false), sendQueued)
    : sendQueued();
  const current = run.finally(() => {
    if (inFlight === current) inFlight = undefined;
  });
  inFlight = current;
  await current;
}

/** Whether nothing is left undelivered from what was queued when it started. */
async function sendQueued(): Promise<boolean> {
  // Copy, not alias — events queued while the request is in flight must not
  // be swept into the "delivered" set below.
  const snapshot = eventQueue.slice();
  const payload = buildPayload(snapshot);
  if (payload == null) return true;
  // Left queued: the exit-time flushSync() sends it from a detached child.
  if (!(await hostAnswers(new URL(POSTHOG_HOST).hostname))) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);

  try {
    const res = await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: payload,
      signal: controller.signal,
    });
    // Nothing reads the reply; drop it so a stalled body cannot hold the socket open.
    await res.body?.cancel();
    // Delivered — forget exactly what was sent (events queued while the
    // request was in flight stay for the next flush).
    const sent = new Set(snapshot);
    eventQueue = eventQueue.filter((e) => !sent.has(e));
    return true;
  } catch {
    // Silently ignore — telemetry must never break the CLI. The events stay
    // queued so the exit-time flushSync() fallback can still deliver them.
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fire-and-forget flush for use in the `exit` event handler.
 * Spawns a detached child process that sends the HTTP request independently,
 * so the parent process exits immediately without waiting.
 */
export function flushSync(): void {
  const payload = buildPayload(eventQueue);
  if (payload == null) return;
  eventQueue = [];

  try {
    const child = spawn(
      process.execPath,
      [
        "-e",
        `fetch(${JSON.stringify(`${POSTHOG_HOST}/batch/`)},{method:"POST",headers:{"Content-Type":"application/json"},body:${JSON.stringify(payload)},signal:AbortSignal.timeout(${FLUSH_TIMEOUT_MS})}).catch(()=>{})`,
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    // Let the parent exit without waiting for the child
    child.unref();
  } catch {
    // Silently ignore
  }
}
