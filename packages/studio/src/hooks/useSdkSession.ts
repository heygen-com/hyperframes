import { useState, useEffect, useCallback, useRef } from "react";
import { openComposition } from "@hyperframes/sdk";
import type { Composition } from "@hyperframes/sdk";
import { isSelfWriteEcho } from "./sdkSelfWriteRegistry";
import { trackStudioEvent } from "../utils/studioTelemetry";
import type { PublishSdkSession } from "../utils/sdkCutover";
import { addExternalFileReloadListener } from "./externalFileReloadBus";

/**
 * Why an optional project-file read produced no usable content. `stage: "read"`
 * was a single opaque reason covering all of these, which made the largest
 * remaining class of SDK-session failures undiagnosable: 56 users in a 7-day
 * window hit it and, between them, never landed a single successful SDK edit.
 * Knowing which branch fired is the difference between "the file legitimately
 * is not there" and "the request never reached the file".
 *
 * Every reason lives in this union so the full surface is readable from one
 * place — `absent_or_empty` included, even though it is a 2xx.
 *
 * `network` is a fetch that REJECTED — the request never produced a response.
 * It was not in this union until 2026-09-21, so it escaped `readProjectFileOptional`
 * and was caught by the effect's outer `.catch`, landing in `stage: "open"`.
 * That label means `openComposition` threw (unparseable composition, OOM), and
 * it is what the largest failure class was reported as. Every `stage: open`
 * event measured on 0.8.56 and 0.8.57 carries a fetch-rejection message —
 * "Failed to fetch", "Load failed", "NetworkError when attempting to fetch
 * resource." — so the class was a network problem filed under a parser one, and
 * unaddressable in that bucket.
 */
type ProjectFileReadFailure =
  | { ok: false; reason: "unsafe_path" }
  | { ok: false; reason: "http_error"; status: number }
  | { ok: false; reason: "missing_content" }
  | { ok: false; reason: "absent_or_empty" }
  | { ok: false; reason: "network" };

type ProjectFileReadResult = { ok: true; content: string } | ProjectFileReadFailure;

/**
 * Record a read that produced no usable content, and answer which project — if
 * any — the failure identifies as unreachable.
 *
 * No SDK session follows a failed read, so EVERY cutover chokepoint takes the
 * server path and emits nothing — the shadow never runs either. A broken read
 * would otherwise be a silent, total SDK bypass, which is why this is recorded
 * at all.
 *
 * Only a 404 identifies the *project*: the server answered, and its answer was
 * that it does not serve this id. A 5xx, a dropped request, an unexpected body
 * and an empty file all say nothing about which project the server serves, so
 * none of them claim it. See `unreachableProject` on the handle.
 *
 * A function rather than three more conditions inline: the read callback it is
 * called from is a long pre-existing async body already near the complexity
 * threshold, and this branch is one coherent unit.
 */
function reportReadFailure(read: ProjectFileReadFailure, projectId: string): string | null {
  trackStudioEvent("sdk_session_unavailable", {
    stage: "read",
    reason: read.reason,
    ...(read.reason === "http_error" ? { status: read.status } : {}),
  });
  if (read.reason !== "http_error") return null;
  return read.status === 404 ? projectId : null;
}

/**
 * Read a project file's content (optional read — a missing file is not an
 * error). Replaces the removed SDK http adapter's `read()` — the only thing
 * Studio used it for (Studio is the sole writer, so the adapter's write path
 * was dead).
 */
async function readProjectFileOptional(
  projectId: string,
  path: string,
): Promise<ProjectFileReadResult> {
  // Reject traversal / NUL before building the request URL — `path` is a
  // user-influenced composition path (mirrors the guard in timelineEditingHelpers,
  // and closes the CodeQL client-side-request-forgery flag). encodeURIComponent
  // already confines both values to single segments of this same-origin URL.
  if (path.includes("\0") || path.includes("..")) return { ok: false, reason: "unsafe_path" };
  let res: Response;
  try {
    res = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(path)}?optional=1`,
    );
  } catch {
    // The request never produced a response: offline, the dev server gone, a
    // CSP/Private-Network-Access block, or an extension rewriting fetch. Caught
    // here so it is reported as a READ failure — left to propagate, the effect's
    // outer catch reported it as `stage: "open"`, which claims the composition
    // failed to parse. Every `stage: open` event before this change was this
    // branch, so the label made the largest class unaddressable.
    return { ok: false, reason: "network" };
  }
  if (!res.ok) return { ok: false, reason: "http_error", status: res.status };
  const data = (await res.json()) as { content?: string };
  // `optional=1` answers a missing file with 200 + `content: ""`, so a
  // non-string here means a response shape we did not expect, not absence.
  if (typeof data.content !== "string") return { ok: false, reason: "missing_content" };
  // An empty body parses into a session with no elements, which declines every
  // edit wholesale — not a session worth opening. The absent-file shim and a
  // genuinely 0-byte file are the same 200 on the wire and cannot be told
  // apart here, hence the name; for a composition it is always the former.
  if (data.content === "") return { ok: false, reason: "absent_or_empty" };
  return { ok: true, content: data.content };
}

/**
 * Stage 7 Step 3a — SDK session wired to the active composition.
 *
 * Creates an SDK Composition (reading the file via the project files API) on
 * every (projectId, activeCompPath) change, disposes the old one on cleanup, and
 * re-opens it when the active composition file changes on disk (code editor,
 * agent, or server-side patch) so the in-memory linkedom document never goes
 * stale. The session has NO persist queue — Studio is the sole file writer; see
 * the open effect below.
 */
/**
 * Decide whether a file-change for the active composition should reload the SDK
 * session. `content` is the new on-disk bytes (from the payload or a re-read);
 * pass null when unavailable. Content-identity wins: a change whose bytes match a
 * registered self-write is our own echo (suppress). Without content we can't prove
 * identity, so we fall back to the time window ONLY to suppress an echo — an undo
 * write outside the window (or any non-self-write) still reloads. Exported for test.
 */
export function shouldReloadOnFileChange(
  activeCompPath: string,
  content: string | null,
  withinSuppressWindow: boolean,
): boolean {
  if (content != null) return !isSelfWriteEcho(activeCompPath, content);
  // No content to compare — preserve the old time-window echo suppression.
  return !withinSuppressWindow;
}

export interface SdkSessionHandle {
  session: Composition | null;
  /** Atomically publish a fully persisted candidate session. */
  publish: PublishSdkSession;
  /**
   * Force a session reload immediately, bypassing the self-write suppress
   * window. Call after undo/redo writes the active composition file so the
   * SDK in-memory document reflects the reverted content. Without it the
   * window swallows the file-change and the session stays stale; the write
   * side of that path is covered by usePersistentEditHistory.test.ts.
   */
  forceReload: () => void;
  /**
   * Set when this server answered the composition read with a 404 for the
   * project it was asked to open. In the CLI-embedded host — the only host
   * that reports telemetry at all (`telemetry/policy.ts` suppresses Vite dev)
   * — that does not mean the project is gone. It means this Studio is serving
   * a *different* one; the project is untouched on disk. Either way every edit
   * in this tab fails, and until now it failed silently.
   *
   * `null` for every other failure: a 500 or a dropped request says nothing
   * about which project the server serves, and `absent_or_empty` /
   * `missing_content` say nothing about the project at all.
   */
  unreachableProject: string | null;
}

interface SdkSessionOwner {
  projectId: string;
  path: string;
  reloadToken: number;
  generation: number;
}

interface OwnedSdkSession extends SdkSessionOwner {
  session: Composition;
}

function isSessionOwnerActive(
  owner: SdkSessionOwner | undefined,
  projectId: string | null,
  path: string | null,
  targetPath: string,
): owner is SdkSessionOwner {
  if (!owner) return false;
  return owner.projectId === projectId && owner.path === path && owner.path === targetPath;
}

function isSessionOwnerCurrent(
  owner: SdkSessionOwner,
  generation: number,
  projectId: string | null,
  path: string | null,
  reloadToken: number,
): boolean {
  return (
    owner.generation === generation &&
    owner.projectId === projectId &&
    owner.path === path &&
    owner.reloadToken === reloadToken
  );
}

function ownsExpectedSession(
  current: OwnedSdkSession | null,
  expectedOwner: SdkSessionOwner,
  expectedSession: Composition,
  reloadToken: number,
): current is OwnedSdkSession {
  if (!current) return false;
  return (
    current.session === expectedSession &&
    current.generation === expectedOwner.generation &&
    current.reloadToken === reloadToken
  );
}

function disposeSdkSession(session: Composition): void {
  try {
    session.dispose();
  } catch (error) {
    trackStudioEvent("sdk_session_dispose_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function useSdkSession(
  projectId: string | null,
  activeCompPath: string | null,
): SdkSessionHandle {
  const [ownedSession, setOwnedSession] = useState<OwnedSdkSession | null>(null);
  const ownedSessionRef = useRef<OwnedSdkSession | null>(null);
  const sessionOwnersRef = useRef(new WeakMap<Composition, SdkSessionOwner>());
  const generationRef = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const activeCompPathRef = useRef(activeCompPath);
  activeCompPathRef.current = activeCompPath;
  const [reloadToken, setReloadToken] = useState(0);
  const reloadTokenRef = useRef(reloadToken);
  reloadTokenRef.current = reloadToken;
  const [unreachableProject, setUnreachableProject] = useState<string | null>(null);

  useEffect(
    () =>
      addExternalFileReloadListener((changedPath) => {
        if (changedPath === activeCompPathRef.current) setReloadToken((token) => token + 1);
      }),
    [],
  );

  // ── Open / re-open the session ──
  useEffect(() => {
    const generation = ++generationRef.current;
    let cancelled = false;

    // The preceding effect normally released its generation first. Clear any
    // remaining owner defensively so an invalid project/path cannot retain it.
    const previous = ownedSessionRef.current;
    ownedSessionRef.current = null;
    setOwnedSession(null);
    if (previous) disposeSdkSession(previous.session);

    if (!projectId || !activeCompPath) {
      setUnreachableProject(null);
      return () => {
        cancelled = true;
      };
    }

    const owner: SdkSessionOwner = {
      projectId,
      path: activeCompPath,
      reloadToken,
      generation,
    };

    readProjectFileOptional(projectId, activeCompPath)
      .then(async (read) => {
        if (cancelled) return;
        if (!read.ok) {
          setUnreachableProject(reportReadFailure(read, projectId));
          return;
        }
        setUnreachableProject(null);
        const content = read.content;
        // No persist queue: Studio's writeProjectFile (via sdkCutover's
        // persistSdkSerialize) is the SINGLE writer. Wiring the SDK persist
        // queue too would double-write the file (queue auto-writes on every
        // 'change' AND Studio writes explicitly) and race on disk; it would
        // also write the full active-composition serialization to the fixed
        // persistPath even when an edit targeted a sub-composition file.
        // Studio's editHistory is the authoritative undo stack — SDK history
        // is unused dead weight here (forceReloadSdkSession discards it on undo).
        const comp = await openComposition(content, { history: false });
        // Cleanup may have fired while openComposition was awaited; dispose immediately.
        if (cancelled) {
          disposeSdkSession(comp);
          return;
        }
        if (
          !isSessionOwnerCurrent(
            owner,
            generationRef.current,
            projectIdRef.current,
            activeCompPathRef.current,
            reloadTokenRef.current,
          )
        ) {
          disposeSdkSession(comp);
          trackStudioEvent("sdk_session_unavailable", { stage: "ownership" });
          return;
        }
        const displaced = ownedSessionRef.current;
        const installed = { ...owner, session: comp };
        sessionOwnersRef.current.set(comp, owner);
        ownedSessionRef.current = installed;
        setOwnedSession(installed);
        if (displaced && displaced.session !== comp) disposeSdkSession(displaced.session);
      })
      .catch((error: unknown) => {
        if (!cancelled && generationRef.current === generation) {
          setOwnedSession(null);
          // openComposition threw (unparseable composition, OOM) — same total
          // bypass as the read failure above, but this one is a real defect
          // rather than a missing file. Carry the message; it is the only clue.
          //
          // A rejected read no longer reaches here: `readProjectFileOptional`
          // catches its own fetch rejection and answers `reason: "network"`, so
          // this stage now means what it says. Before that, every event in this
          // bucket was a network error wearing a parser's label.
          trackStudioEvent("sdk_session_unavailable", {
            stage: "open",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
      // Publication preserves this generation, so cleanup releases whichever
      // session it currently owns (the initially opened one or its candidate).
      const owned = ownedSessionRef.current;
      if (owned?.generation === generation) {
        ownedSessionRef.current = null;
        disposeSdkSession(owned.session);
      }
    };
  }, [projectId, activeCompPath, reloadToken]);

  const forceReload = useCallback(() => setReloadToken((t) => t + 1), []);
  const publish = useCallback<PublishSdkSession>(({ candidate, expectedSession, targetPath }) => {
    const expectedOwner = sessionOwnersRef.current.get(expectedSession);
    const current = ownedSessionRef.current;
    if (
      !isSessionOwnerActive(
        expectedOwner,
        projectIdRef.current,
        activeCompPathRef.current,
        targetPath,
      )
    ) {
      return "rejected-inactive-target";
    }
    if (!ownsExpectedSession(current, expectedOwner, expectedSession, reloadTokenRef.current)) {
      // The durable write won, but another session was installed for this same
      // path before publication. Its self-write echo will be suppressed, so
      // explicitly re-open it from disk instead of leaving it stale.
      setReloadToken((t) => t + 1);
      return "rejected-active-target";
    }
    const next: OwnedSdkSession = { ...current, session: candidate };
    sessionOwnersRef.current.set(candidate, current);
    ownedSessionRef.current = next;
    setOwnedSession(next);
    if (current.session !== candidate) disposeSdkSession(current.session);
    return "published";
  }, []);
  const session =
    ownedSession?.projectId === projectId &&
    ownedSession.path === activeCompPath &&
    ownedSession.reloadToken === reloadToken
      ? ownedSession.session
      : null;
  return { session, publish, forceReload, unreachableProject };
}
