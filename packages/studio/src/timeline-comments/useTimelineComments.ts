import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import {
  createAgentRunController,
  shouldCompleteActive,
  type AgentRunState,
} from "./agentRunController";
import type {
  AgentCommentStatusMap,
  AgentRunPreview,
  SendPromptToAgentInput,
  TimelineComment,
} from "./types";

interface EditingFile {
  path: string;
  content: string | null;
}

class AgentBusyError extends Error {
  constructor() {
    super("Agent is already running. Try again when it finishes.");
    this.name = "AgentBusyError";
  }
}

interface UseTimelineCommentsOptions {
  projectId: string | null;
  activeCompPath: string | null;
  editingPathRef: RefObject<string | null | undefined>;
  refreshKey: number;
  setEditingFile: Dispatch<SetStateAction<EditingFile | null>>;
  onProjectContentChanged: () => void;
  onNotify?: (message: string, tone?: "error" | "info") => void;
}

async function fetchTimelineComments(projectId: string): Promise<TimelineComment[]> {
  const response = await fetch(`/api/projects/${projectId}/timeline-comments`);
  if (!response.ok) return [];
  const data = (await response.json()) as { comments?: TimelineComment[] };
  return data.comments ?? [];
}

function parseAgentRunPreview(data: Partial<AgentRunPreview>): AgentRunPreview {
  return {
    ready: data.ready === true,
    agent: typeof data.agent === "string" ? data.agent : null,
    path: typeof data.path === "string" ? data.path : null,
    reason: typeof data.reason === "string" ? data.reason : undefined,
    adapters: Array.isArray(data.adapters)
      ? data.adapters
          .filter((a): a is { kind: string; detected: boolean } => typeof a?.kind === "string")
          .map((a) => ({ kind: a.kind, detected: a.detected === true }))
      : undefined,
  };
}

async function fetchAgentRunPreview(projectId: string): Promise<AgentRunPreview | null> {
  const response = await fetch(`/api/projects/${projectId}/agent/preview`);
  if (!response.ok) return null;
  return parseAgentRunPreview((await response.json()) as Partial<AgentRunPreview>);
}

async function fetchActiveCommentId(projectId: string): Promise<string | null> {
  const response = await fetch(`/api/projects/${projectId}/agent/active-run`);
  if (!response.ok) return null;
  const data = (await response.json()) as { run?: { commentId?: unknown } | null };
  const commentId = data.run?.commentId;
  return typeof commentId === "string" ? commentId : null;
}

async function createTimelineComment(
  projectId: string,
  input: SendPromptToAgentInput & { filePath: string },
): Promise<{ comment?: TimelineComment; content?: string }> {
  const targetElement = input.elements[0];
  const response = await fetch(`/api/projects/${projectId}/timeline-comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filePath: input.filePath,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      prompt: input.prompt,
      elements: input.elements,
      target: targetElement
        ? {
            id: targetElement.domId,
            selector: targetElement.selector,
            selectorIndex: targetElement.selectorIndex,
          }
        : undefined,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create timeline comment (${response.status})`);
  }
  return (await response.json()) as { comment?: TimelineComment; content?: string };
}

async function streamAgentRun(
  projectId: string,
  comment: TimelineComment,
  signal: AbortSignal,
  onEvent?: (rawLine: string) => void,
): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/agent/resolve-comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      commentId: comment.id,
      filePath: comment.filePath,
      prompt: comment.prompt,
      rangeStart: comment.rangeStart,
      rangeEnd: comment.rangeEnd,
      elements: comment.elements,
    }),
  });
  if (response.status === 409) {
    throw new AgentBusyError();
  }
  if (!response.ok || !response.body) {
    throw new Error(`Agent request failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent?.(line);
      const message = JSON.parse(line) as { type?: string; error?: string };
      if (message.type === "error" && message.error) {
        throw new Error(message.error);
      }
    }
  }
}

export function useTimelineComments({
  projectId,
  activeCompPath,
  editingPathRef,
  refreshKey,
  setEditingFile,
  onProjectContentChanged,
  onNotify,
}: UseTimelineCommentsOptions) {
  const [timelineComments, setTimelineComments] = useState<TimelineComment[]>([]);
  const [commentsTrayOpen, setCommentsTrayOpen] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentCommentStatusMap>({});
  const [agentRunPreview, setAgentRunPreview] = useState<AgentRunPreview | null>(null);

  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const onProjectContentChangedRef = useRef(onProjectContentChanged);
  onProjectContentChangedRef.current = onProjectContentChanged;

  const refreshTimelineComments = useCallback(async () => {
    if (!projectId) return;
    setTimelineComments(await fetchTimelineComments(projectId));
  }, [projectId]);

  const setStatus = useCallback((commentId: string, state: AgentRunState | null) => {
    setAgentStatus((prev) => {
      if (state === null) {
        if (!(commentId in prev)) return prev;
        const next = { ...prev };
        delete next[commentId];
        return next;
      }
      return { ...prev, [commentId]: state };
    });
  }, []);

  const agentRunPreviewRef = useRef<AgentRunPreview | null>(null);
  agentRunPreviewRef.current = agentRunPreview;

  const previewMeta = useCallback(
    () => ({
      agent: agentRunPreviewRef.current?.agent ?? null,
      path: agentRunPreviewRef.current?.path ?? null,
    }),
    [],
  );

  const agentRunController = useMemo(
    () =>
      createAgentRunController({
        run: async (comment, signal) => {
          const pid = projectIdRef.current;
          if (!pid) throw new Error("no project");
          await streamAgentRun(pid, comment, signal, (line) => {
            setStatus(comment.id, { status: "running", ...previewMeta(), lastMessage: line });
          });
        },
        onStatus: setStatus,
        onSettled: () => {
          void refreshTimelineComments();
          onProjectContentChangedRef.current();
        },
        isBlockedError: (err) => err instanceof AgentBusyError,
        onBlocked: () => {
          onNotify?.("Agent is already running. Try again when it finishes.", "info");
        },
      }),
    [onNotify, previewMeta, refreshTimelineComments, setStatus],
  );

  const runAgentForComment = useCallback(
    (comment: TimelineComment) => {
      const started = agentRunController.run(comment, previewMeta());
      if (!started) {
        onNotify?.("Agent is already running. Try again when it finishes.", "info");
      }
    },
    [agentRunController, onNotify, previewMeta],
  );

  const cancelAgentRun = useCallback(
    (commentId: string) => {
      const wasActive = agentRunController.activeId() === commentId;
      agentRunController.cancel(commentId);
      if (wasActive && projectId) {
        void fetch(`/api/projects/${projectId}/agent/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commentId }),
        }).catch(() => null);
      }
    },
    [agentRunController, projectId],
  );

  const clearTimelineComment = useCallback(
    async (commentId: string) => {
      if (!projectId) return;
      agentRunController.cancel(commentId);
      await fetch(`/api/projects/${projectId}/timeline-comments/${commentId}`, {
        method: "DELETE",
      });
      setStatus(commentId, null);
      await refreshTimelineComments();
      onProjectContentChanged();
    },
    [agentRunController, onProjectContentChanged, projectId, refreshTimelineComments, setStatus],
  );

  const setPreferredAdapter = useCallback(
    async (adapterKind: string) => {
      if (!projectId) return;
      try {
        const response = await fetch(`/api/projects/${projectId}/agent/adapter`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adapter: adapterKind }),
        });
        if (!response.ok) {
          onNotify?.(`Failed to set agent (${response.status})`, "error");
          return;
        }
        const data = (await response.json()) as Partial<AgentRunPreview>;
        setAgentRunPreview(parseAgentRunPreview(data));
      } catch (err) {
        onNotify?.(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [onNotify, projectId],
  );

  const copyTimelineCommentPrompt = useCallback(async (comment: TimelineComment) => {
    try {
      await navigator.clipboard.writeText(comment.prompt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = comment.prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, []);

  const sendPromptToAgent = useCallback(
    async (input: SendPromptToAgentInput) => {
      if (!projectId) return;
      const targetElement = input.elements[0];
      const filePath = targetElement?.sourceFile || activeCompPath || "index.html";
      const data = await createTimelineComment(projectId, { ...input, filePath });
      if (data.content && editingPathRef.current === filePath) {
        setEditingFile({ path: filePath, content: data.content });
      }
      await refreshTimelineComments();
      onProjectContentChanged();
      setCommentsTrayOpen(true);
      if (data.comment) {
        const started = agentRunController.run(data.comment, previewMeta());
        if (!started) {
          onNotify?.("Agent is already running. Run this comment when it finishes.", "info");
        }
      }
    },
    [
      agentRunController,
      activeCompPath,
      editingPathRef,
      onNotify,
      onProjectContentChanged,
      previewMeta,
      projectId,
      refreshTimelineComments,
      setEditingFile,
    ],
  );

  useEffect(() => {
    void refreshTimelineComments();
  }, [refreshKey, refreshTimelineComments]);

  useEffect(() => {
    if (!projectId) {
      setAgentRunPreview(null);
      return;
    }
    let cancelled = false;
    void fetchAgentRunPreview(projectId)
      .then((preview) => {
        if (!cancelled) setAgentRunPreview(preview);
      })
      .catch(() => {
        if (!cancelled) setAgentRunPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void fetchActiveCommentId(projectId).then((commentId) => {
      if (!cancelled && commentId) {
        setStatus(commentId, { status: "running", ...previewMeta() });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [previewMeta, projectId, setStatus]);

  useEffect(() => () => agentRunController.abortAll(), [agentRunController]);

  // The agent is instructed to remove the comment marker when its work is done.
  // If the stream itself doesn't terminate (some agents keep their session
  // alive after completing the task), the marker-gone state is our authoritative
  // completion signal — cancel the open fetch so the active slot is released.
  useEffect(() => {
    const active = agentRunController.activeId();
    if (shouldCompleteActive(active, timelineComments)) {
      agentRunController.cancel(active!);
    }
  }, [agentRunController, timelineComments]);

  return {
    comments: timelineComments,
    trayProps: {
      comments: timelineComments,
      open: commentsTrayOpen,
      status: agentStatus,
      onToggleOpen: () => setCommentsTrayOpen((open) => !open),
      onClose: () => setCommentsTrayOpen(false),
      onRunAgent: runAgentForComment,
      onCopyPrompt: copyTimelineCommentPrompt,
      onClear: clearTimelineComment,
      onCancelAgentRun: cancelAgentRun,
    },
    sendPromptToAgent,
    agentRunPreview,
    setPreferredAdapter,
  };
}
