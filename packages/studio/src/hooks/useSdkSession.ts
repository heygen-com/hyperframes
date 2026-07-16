import { useState, useEffect, useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import { openComposition } from "@hyperframes/sdk";
import type { Composition } from "@hyperframes/sdk";
import { readStudioFileChangePath } from "../components/editor/manualEdits";
import { isSelfWriteEcho } from "./sdkSelfWriteRegistry";
import { trackStudioEvent } from "../utils/studioTelemetry";
import type { PublishSdkSession } from "../utils/sdkCutover";

/**
 * Read a project file's content, or undefined on a non-2xx (optional read).
 * Replaces the removed SDK http adapter's `read()` — the only thing Studio used
 * it for (Studio is the sole writer, so the adapter's write path was dead).
 */
async function readProjectFileOptional(
  projectId: string,
  path: string,
): Promise<string | undefined> {
  // Reject traversal / NUL before building the request URL — `path` is a
  // user-influenced composition path (mirrors the guard in timelineEditingHelpers,
  // and closes the CodeQL client-side-request-forgery flag). encodeURIComponent
  // already confines both values to single segments of this same-origin URL.
  if (path.includes("\0") || path.includes("..")) return undefined;
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(path)}?optional=1`,
  );
  if (!res.ok) return undefined;
  const data = (await res.json()) as { content?: string };
  return typeof data.content === "string" ? data.content : undefined;
}

/**
 * True when an external file-change payload targets the active composition and
 * the SDK session must be re-opened to pick up the new content.
 */
export function shouldReloadSdkSession(payload: unknown, activeCompPath: string | null): boolean {
  if (!activeCompPath) return false;
  return readStudioFileChangePath(payload) === activeCompPath;
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
// Reload-suppression baseline: a file-change within this window of our own SDK
// cutover write is a CANDIDATE echo, but the decision is content-identity based
// (isSelfWriteEcho) not time-only — so an undo write that lands inside the window
// still reloads (its reverted bytes were never registered as a self-write). The
// window only bounds how long a registered self-write stays suppressible.
const SELF_WRITE_SUPPRESS_MS = 2000;

/** Best-effort read of the changed file's content from a file-change payload. */
function readFileChangeContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  if ("data" in record) return readFileChangeContent(record.data);
  return null;
}

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
   * SDK in-memory document reflects the reverted content.
   */
  forceReload: () => void;
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
  domEditSaveTimestampRef?: MutableRefObject<number>,
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

  // ── Re-open on external change to the active composition ──
  useEffect(() => {
    if (!activeCompPath) return;
    const compPath = activeCompPath;
    const readProjectId = projectId ?? null;
    const handler = (payload?: unknown) => {
      if (!shouldReloadSdkSession(payload, compPath)) return;
      const withinWindow =
        !!domEditSaveTimestampRef &&
        Date.now() - domEditSaveTimestampRef.current < SELF_WRITE_SUPPRESS_MS;
      const decide = (content: string | null) => {
        if (shouldReloadOnFileChange(compPath, content, withinWindow)) setReloadToken((t) => t + 1);
      };
      const payloadContent = readFileChangeContent(payload);
      // Prefer payload content; otherwise re-read so the decision is by IDENTITY
      // (an undo's reverted bytes won't match a registered self-write → reload).
      if (payloadContent != null || readProjectId == null) {
        decide(payloadContent);
        return;
      }
      readProjectFileOptional(readProjectId, compPath)
        .then((c) => decide(c ?? null))
        .catch(() => decide(null));
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for the embedded studio server.
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCompPath, projectId]);

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
      .then(async (content) => {
        if (cancelled || typeof content !== "string") return;
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
          return;
        }
        const displaced = ownedSessionRef.current;
        const installed = { ...owner, session: comp };
        sessionOwnersRef.current.set(comp, owner);
        ownedSessionRef.current = installed;
        setOwnedSession(installed);
        if (displaced && displaced.session !== comp) disposeSdkSession(displaced.session);
      })
      .catch(() => {
        if (!cancelled && generationRef.current === generation) setOwnedSession(null);
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
  return { session, publish, forceReload };
}
