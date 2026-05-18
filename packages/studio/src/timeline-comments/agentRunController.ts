import type { TimelineComment } from "./types";

/**
 * Returns true if the active run should be force-completed because its
 * source-of-truth marker has disappeared from the comments list. The agent
 * is instructed to remove the `<!-- hyperframes-comment ... -->` marker as
 * its completion signal, so an active id that's no longer in the list means
 * the work is done even if the network stream hasn't closed.
 */
export function shouldCompleteActive(
  activeId: string | null,
  comments: ReadonlyArray<{ id: string }>,
): boolean {
  return !!activeId && !comments.some((c) => c.id === activeId);
}

export interface AgentRunMeta {
  agent?: string | null;
  path?: string | null;
}

export type AgentRunState =
  | ({ status: "running" } & AgentRunMeta & { lastMessage?: string })
  | { status: "stopped"; message: string }
  | { status: "error"; message: string };

export interface AgentRunControllerOptions {
  run: (comment: TimelineComment, signal: AbortSignal) => Promise<void>;
  onStatus: (commentId: string, state: AgentRunState | null) => void;
  onSettled?: (commentId: string) => void;
  isBlockedError?: (err: unknown) => boolean;
  onBlocked?: (commentId: string, err: unknown) => void;
}

export interface AgentRunController {
  run: (comment: TimelineComment, meta?: AgentRunMeta) => boolean;
  cancel: (commentId: string) => void;
  activeId: () => string | null;
  abortAll: () => void;
}

export function createAgentRunController({
  run,
  onStatus,
  onSettled,
  isBlockedError,
  onBlocked,
}: AgentRunControllerOptions): AgentRunController {
  let activeId: string | null = null;
  let activeAbort: AbortController | null = null;

  return {
    run(comment, meta = {}) {
      if (activeId) return false;
      activeId = comment.id;
      const controller = new AbortController();
      activeAbort = controller;
      onStatus(comment.id, { status: "running", ...meta });
      run(comment, controller.signal)
        .then(() => {
          onStatus(comment.id, { status: "stopped", message: "Done." });
        })
        .catch((err: unknown) => {
          if (isBlockedError?.(err)) {
            onStatus(comment.id, null);
            onBlocked?.(comment.id, err);
          } else if (controller.signal.aborted) {
            onStatus(comment.id, { status: "stopped", message: "Stopped." });
          } else {
            const message = err instanceof Error ? err.message : String(err);
            onStatus(comment.id, { status: "error", message });
          }
        })
        .finally(() => {
          activeId = null;
          activeAbort = null;
          try {
            onSettled?.(comment.id);
          } catch {
            // user callback must not strand future runs
          }
        });
      return true;
    },
    cancel(commentId) {
      if (activeId === commentId) {
        activeAbort?.abort();
      }
    },
    activeId: () => activeId,
    abortAll() {
      activeAbort?.abort();
    },
  };
}
