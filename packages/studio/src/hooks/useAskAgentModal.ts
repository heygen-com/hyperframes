import { useState, useCallback, useRef, useEffect } from "react";
import { copyTextToClipboard } from "../utils/clipboard";
import { readTagSnippetByTarget } from "../utils/sourcePatcher";
import { toProjectAbsolutePath } from "../utils/studioHelpers";
import { buildElementAgentPrompt, type DomEditSelection } from "../components/editor/domEditing";
import type { InlineAgentRunResult } from "../components/editor/InlineAgentComposer";
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
  const [agentRunning, setAgentRunning] = useState(false);

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

  const handleAskAgent = useCallback(() => {
    const selection = resolveSelection();
    if (!selection) return;
    setAgentPromptTagSnippet(undefined);
    setAgentPromptSelectionContext(undefined);
    void preloadAgentPromptSnippet(selection);
    setAgentModalOpen(true);

    const pid = projectIdRef.current;
    if (!pid) return;
    void fetch(`/api/projects/${pid}/agent`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { available?: boolean; label?: string | null } | null) => {
        setAgentRunLabel(data?.available ? (data.label ?? "agent") : null);
      })
      .catch(() => setAgentRunLabel(null));
  }, [preloadAgentPromptSnippet, projectIdRef, resolveSelection]);

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
   * Hand the prompt to the user's own agent CLI; the file watcher reloads the
   * preview. The composer stays open on the canvas and reports the outcome
   * inline, so the next instruction is one keystroke away.
   */
  const handleAgentModalRun = useCallback(
    async (userInstruction: string): Promise<InlineAgentRunResult> => {
      const selection = resolveSelection();
      const pid = projectIdRef.current;
      if (!selection || !pid) return { ok: false, message: "Nothing selected." };

      setAgentRunning(true);
      try {
        const response = await fetch(`/api/projects/${pid}/agent`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: buildPrompt(selection, userInstruction) }),
        });
        const data = (await response.json()) as {
          error?: string;
          exitCode?: number;
          label?: string;
        };
        if (!response.ok || data.exitCode) {
          return { ok: false, message: data.error ?? `Agent exited with code ${data.exitCode}` };
        }
        return { ok: true, message: `${data.label ?? "Agent"} finished.` };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Agent run failed." };
      } finally {
        setAgentRunning(false);
      }
    },
    [buildPrompt, projectIdRef, resolveSelection],
  );

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
    agentRunning,

    // Setters (consumed by handlePreviewCanvasMouseDown and other callers)
    setAgentModalOpen,
    setAgentPromptSelectionContext,

    // Callbacks
    preloadAgentPromptSnippet,
    handleAskAgent,
    handleAgentModalSubmit,
    handleAgentModalRun,
  };
}
