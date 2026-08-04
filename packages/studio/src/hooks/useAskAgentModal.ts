import { useState, useCallback, useRef, useEffect } from "react";
import { copyTextToClipboard } from "../utils/clipboard";
import { readTagSnippetByTarget } from "../utils/sourcePatcher";
import { toProjectAbsolutePath } from "../utils/studioHelpers";
import { buildElementAgentPrompt, type DomEditSelection } from "../components/editor/domEditing";
import type { AgentJob, AgentKind } from "../components/editor/agentGlyphs";
import { usePlayerStore } from "../player";

// ── Types ──

export interface UseAskAgentModalParams {
  projectId: string | null;
  activeCompPath: string | null;
  projectDir: string | null;
  projectIdRef: React.MutableRefObject<string | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  domEditSelection: DomEditSelection | null;
}

// ── Hook ──

export function useAskAgentModal({
  projectId,
  activeCompPath,
  projectDir,
  projectIdRef,
  showToast,
  domEditSelectionRef,
  domEditSelection,
}: UseAskAgentModalParams) {
  // ── State ──

  const [agentPromptTagSnippet, setAgentPromptTagSnippet] = useState<string | undefined>();
  const [agentPromptSelectionContext, setAgentPromptSelectionContext] = useState<
    string | undefined
  >();
  const [copiedAgentPrompt, setCopiedAgentPrompt] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  // null while unknown — the Run button stays hidden until the server confirms
  // a harness CLI (claude / codex / HYPERFRAMES_AGENT_CMD) is installed.
  const [agentRunLabel, setAgentRunLabel] = useState<string | null>(null);
  const [agentRunKind, setAgentRunKind] = useState<AgentKind | null>(null);
  const [agentIconUrl, setAgentIconUrl] = useState<string | null>(null);
  const [agentJobs, setAgentJobs] = useState<AgentJob[]>([]);

  // ── Refs ──

  const copiedAgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Callbacks ──

  const preloadAgentPromptSnippet = useCallback(
    async (selection: DomEditSelection) => {
      const pid = projectIdRef.current;
      if (!pid) return;

      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      try {
        const response = await fetch(
          `/api/projects/${pid}/files/${encodeURIComponent(targetPath)}`,
        );
        if (!response.ok) return;

        const data = (await response.json()) as { content?: string };
        const html = data.content;
        const tagSnippet =
          typeof html === "string" ? readTagSnippetByTarget(html, selection) : undefined;

        setAgentPromptTagSnippet((current) => {
          if (domEditSelectionRef.current !== selection) return current;
          return tagSnippet;
        });
      } catch {
        // Runtime outerHTML is still available as a synchronous copy fallback.
      }
    },
    [activeCompPath, domEditSelectionRef, projectIdRef],
  );

  // The ref, not the state value: a timeline clip applies its selection and
  // opens the modal in the same tick, so the state copy is still stale here.
  const resolveSelection = useCallback(
    () => domEditSelectionRef.current ?? domEditSelection,
    [domEditSelection, domEditSelectionRef],
  );

  /** One read for both the installed harness and this project's run list. */
  const refreshAgentState = useCallback(async () => {
    // The prop, not just the ref: on a page load the ref is still null when the
    // first read fires, and the tray would come up empty despite live runs.
    const pid = projectId ?? projectIdRef.current;
    if (!pid) return;
    try {
      const response = await fetch(`/api/projects/${pid}/agent`);
      if (!response.ok) return;
      const data = (await response.json()) as {
        available?: boolean;
        label?: string | null;
        kind?: AgentKind;
        iconUrl?: string | null;
        jobs?: AgentJob[];
      };
      setAgentRunLabel(data.available ? (data.label ?? "agent") : null);
      setAgentRunKind(data.available ? (data.kind ?? "custom") : null);
      setAgentIconUrl(data.iconUrl ?? null);
      setAgentJobs(data.jobs ?? []);
    } catch {
      // Server not reachable — leave the last known state on screen.
    }
  }, [projectId, projectIdRef]);

  const handleAskAgent = useCallback(() => {
    const selection = resolveSelection();
    if (!selection) return;
    setAgentPromptTagSnippet(undefined);
    setAgentPromptSelectionContext(undefined);
    void preloadAgentPromptSnippet(selection);
    setAgentModalOpen(true);
    void refreshAgentState();
  }, [preloadAgentPromptSnippet, refreshAgentState, resolveSelection]);

  const buildPrompt = useCallback(
    (selection: DomEditSelection, userInstruction: string) => {
      const targetPath = selection.sourceFile || activeCompPath || "index.html";
      return buildElementAgentPrompt({
        selection,
        currentTime: usePlayerStore.getState().currentTime,
        tagSnippet: agentPromptTagSnippet ?? selection.element.outerHTML,
        selectionContext: agentPromptSelectionContext,
        userInstruction,
        sourceFilePath: toProjectAbsolutePath(projectDir, targetPath),
      });
    },
    [activeCompPath, agentPromptSelectionContext, agentPromptTagSnippet, projectDir],
  );

  /**
   * Queue a run and return — the server owns the job, so the composer accepts
   * the next instruction immediately and the tray (and a page reload) keeps
   * showing everything in flight.
   */
  const handleAgentModalRun = useCallback(
    (userInstruction: string) => {
      const selection = resolveSelection();
      const pid = projectIdRef.current;
      if (!selection || !pid) return;

      void fetch(`/api/projects/${pid}/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: buildPrompt(selection, userInstruction),
          instruction: userInstruction,
          target: selection.label,
        }),
      })
        .then(async (response) => {
          const data = (await response.json()) as { error?: string; job?: AgentJob };
          if (!response.ok || !data.job) {
            showToast(data.error ?? "Could not start the agent.", "error");
            return;
          }
          setAgentJobs((jobs) => [data.job as AgentJob, ...jobs]);
        })
        .catch((err: unknown) => {
          showToast(err instanceof Error ? err.message : "Could not start the agent.", "error");
        });
    },
    [buildPrompt, projectIdRef, resolveSelection, showToast],
  );

  const clearFinishedAgentJobs = useCallback(() => {
    const pid = projectIdRef.current;
    if (!pid) return;
    void fetch(`/api/projects/${pid}/agent/jobs`, { method: "DELETE" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { jobs?: AgentJob[] } | null) => setAgentJobs(data?.jobs ?? []))
      .catch(() => undefined);
  }, [projectIdRef]);

  const handleAgentModalSubmit = useCallback(
    async (userInstruction: string) => {
      const selection = resolveSelection();
      if (!selection) return;

      const prompt = buildPrompt(selection, userInstruction);
      const copied = await copyTextToClipboard(prompt);
      if (!copied) {
        showToast("Could not copy prompt to clipboard.", "error");
        return;
      }

      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
      setCopiedAgentPrompt(true);
      copiedAgentTimerRef.current = setTimeout(() => setCopiedAgentPrompt(false), 1600);
    },
    [buildPrompt, resolveSelection, showToast],
  );

  // ── Effects ──

  // Runs live on the server, so read them once on mount: a reload lands back on
  // whatever is still in flight instead of an empty tray.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    void refreshAgentState();
  }, [refreshAgentState]);

  // Poll only while something is queued or running — an idle tray costs nothing.
  const hasActiveJob = agentJobs.some((job) => job.status === "queued" || job.status === "running");
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = setInterval(() => void refreshAgentState(), 1200);
    return () => clearInterval(timer);
  }, [hasActiveJob, refreshAgentState]);

  // Clear agent-prompt state when selection changes
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    setAgentPromptTagSnippet(undefined);
    setAgentPromptSelectionContext(undefined);
    setCopiedAgentPrompt(false);
  }, [domEditSelection]);

  // Cleanup copiedAgentTimerRef
  // eslint-disable-next-line no-restricted-syntax
  useEffect(
    () => () => {
      if (copiedAgentTimerRef.current) clearTimeout(copiedAgentTimerRef.current);
    },
    [],
  );

  return {
    // State
    agentModalOpen,
    copiedAgentPrompt,
    agentPromptSelectionContext,
    agentRunLabel,
    agentRunKind,
    agentIconUrl,
    agentJobs,

    // Setters (consumed by handlePreviewCanvasMouseDown and other callers)
    setAgentModalOpen,
    setAgentPromptSelectionContext,

    // Callbacks
    preloadAgentPromptSnippet,
    handleAskAgent,
    handleAgentModalSubmit,
    handleAgentModalRun,
    clearFinishedAgentJobs,
  };
}
