import { useEffect, useState } from "react";
import { buildProjectHash, parseProjectIdFromHash } from "../utils/projectRouting";
import { useMountEffect } from "./useMountEffect";
import { trackStudioEvent } from "../utils/studioTelemetry";

interface ServerConnectionState {
  projectId: string | null;
  resolving: boolean;
  waitingForServer: boolean;
}

/**
 * Resolves the active project ID by pinging /api/projects.
 *
 * If the hash contains a project ID the server is still contacted — this
 * ensures a dead server (bookmark-reload case) enters the waiting state
 * rather than mounting the full Studio against a non-responsive API.
 *
 * Polls every 2 s until the server responds, then transitions automatically.
 * Cleans up pending timers on unmount so it is safe under React StrictMode.
 */
/**
 * Whether a hash-supplied project id still names something the server can
 * resolve. Three answers, not two: a failed request must NOT be read as
 * "missing", or one network blip would discard a perfectly good deep link.
 *
 * Resolved through `/api/projects/:id`, which calls the same
 * `adapter.resolveProject` the file routes use. A match against the
 * `/api/projects` list would be wrong twice over: that list omits session ids
 * (which resolve fine) and skips project dirs without an `index.html`.
 */
type ProjectHashVerdict = {
  outcome: "ok" | "missing" | "unknown";
  /** HTTP status when the server answered; absent on a rejected request. */
  status?: number;
};

async function resolveHashProject(id: string): Promise<ProjectHashVerdict> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    if (res.ok) return { outcome: "ok", status: res.status };
    return { outcome: res.status === 404 ? "missing" : "unknown", status: res.status };
  } catch {
    return { outcome: "unknown" };
  }
}

/**
 * What the hash validation decided. Without this, a tab that kept a hash
 * because the check itself failed ("unknown") is indistinguishable from one
 * that never ran the check — the two have different fixes and, until this
 * event, no way to tell them apart in production.
 */
function reportHashVerdict(stage: "mount" | "hashchange", verdict: ProjectHashVerdict): void {
  trackStudioEvent("project_hash_validated", {
    stage,
    outcome: verdict.outcome,
    ...(verdict.status === undefined ? {} : { status: verdict.status }),
  });
}

export function useServerConnection(): ServerConnectionState {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);
  const [waitingForServer, setWaitingForServer] = useState(false);

  useMountEffect(() => {
    const hashProjectId = parseProjectIdFromHash(window.location.hash);
    let cancelled = false;
    // Explicitly `number` (the DOM return of window.setTimeout) rather than
    // ReturnType<typeof window.setTimeout> — with @types/node present, that infers
    // NodeJS.Timeout and clashes with the DOM number the call actually returns.
    let retryTimer: number | null = null;

    function scheduleRetry() {
      setWaitingForServer(true);
      retryTimer = window.setTimeout(tryConnect, 2000);
    }

    function tryConnect() {
      fetch("/api/projects")
        .then((r) => r.json())
        .then(async (data) => {
          if (cancelled) return;
          // A hash project id outlives the project it names — a renamed folder,
          // or a bookmark from a project that is gone. Trusting it blindly made
          // every later /api/projects/<id>/... request 404 for the life of the
          // tab, including the composition read that opens the SDK session, so
          // every edit fell back to the server path with nothing to show why.
          // Telemetry after the read-reason split: 120 http_error/404 reads
          // across 5 users in 24h, ~24 each, never recovering.
          if (hashProjectId) {
            const verdict = await resolveHashProject(hashProjectId);
            if (cancelled) return;
            reportHashVerdict("mount", verdict);
            // "unknown" keeps the old behaviour: a transient failure must not
            // rewrite the user's hash out from under a valid project.
            if (verdict.outcome !== "missing") {
              setProjectId(hashProjectId);
              setWaitingForServer(false);
              return;
            }
          }
          const first = (data.projects ?? [])[0];
          if (first) {
            setProjectId(first.id);
            setWaitingForServer(false);
            window.location.hash = buildProjectHash(first.id);
          } else {
            scheduleRetry();
          }
        })
        .catch(() => {
          if (!cancelled) scheduleRetry();
        })
        .finally(() => {
          if (!cancelled) setResolving(false);
        });
    }

    tryConnect();
    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  });

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const onHashChange = () => {
      const next = parseProjectIdFromHash(window.location.hash);
      if (next && next !== projectId) setProjectId(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [projectId]);

  return { projectId, resolving, waitingForServer };
}
