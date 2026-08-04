import { useState, useCallback, useRef, useEffect } from "react";
import { copyTextToClipboard } from "../utils/clipboard";
import { readTagSnippetByTarget } from "../utils/sourcePatcher";
import { toProjectAbsolutePath } from "../utils/studioHelpers";
import { buildElementAgentPrompt, type DomEditSelection } from "../components/editor/domEditing";
import type {
  AgentJob,
  AgentKind,
  AgentModel,
  AgentOption,
} from "../components/editor/agentGlyphs";
import { findElementForSelection } from "../components/editor/domEditing";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../utils/studioUiPreferences";
import { usePlayerStore } from "../player";

// ── Types ──

export interface UseAskAgentModalParams {
  projectId: string | null;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: { revealPanel?: boolean },
  ) => void;
  buildDomSelectionFromTarget: (
    element: HTMLElement,
    options?: { preferClipAncestor?: boolean },
  ) => Promise<DomEditSelection | null>;
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
  previewIframeRef,
  applyDomSelection,
  buildDomSelectionFromTarget,
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
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  // Null means "whatever the server resolves"; a pick sticks for later runs, so
  // a queue can mix harnesses without re-choosing every time.
  const [selectedAgentKind, setSelectedAgentKindState] = useState<AgentKind | null>(
    () => readStudioUiPreferences().agentKind ?? null,
  );
  const setSelectedAgentKind = useCallback((kind: AgentKind | null) => {
    setSelectedAgentKindState(kind);
    writeStudioUiPreferences({ agentKind: kind ?? undefined });
  }, []);
  const [agentModels, setAgentModels] = useState<AgentModel[]>([]);
  const [modelByKind, setModelByKind] = useState<Partial<Record<AgentKind, string>>>(
    () => readStudioUiPreferences().agentModelByKind ?? {},
  );
  const [agentJobs, setAgentJobs] = useState<AgentJob[]>([]);

  // ── Refs ──

  const copiedAgentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The run POST reads the harness at submit time; a ref keeps that current
  // without rebuilding the callback on every catalog refresh.
  const activeKindRef = useRef<AgentKind | null>(null);

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
        agents?: AgentOption[];
        jobs?: AgentJob[];
      };
      setAgentRunLabel(data.available ? (data.label ?? "agent") : null);
      setAgentRunKind(data.available ? (data.kind ?? "custom") : null);
      setAgentIconUrl(data.iconUrl ?? null);
      setAgentOptions(data.agents ?? []);
      setAgentJobs(data.jobs ?? []);
    } catch {
      // Server not reachable — leave the last known state on screen.
    }
  }, [projectId, projectIdRef]);

  /** The catalog decides what exists; Studio only asks for the active harness. */
  const refreshAgentModels = useCallback(
    async (kind: AgentKind | null) => {
      const pid = projectId ?? projectIdRef.current;
      if (!pid) return;
      try {
        const query = kind ? `?agent=${encodeURIComponent(kind)}` : "";
        const response = await fetch(`/api/projects/${pid}/agent/models${query}`);
        if (!response.ok) return;
        const data = (await response.json()) as { models?: AgentModel[] };
        setAgentModels(data.models ?? []);
      } catch {
        setAgentModels([]);
      }
    },
    [projectId, projectIdRef],
  );

  const setSelectedModel = useCallback((kind: AgentKind, model: string | null) => {
    setModelByKind((current) => {
      const next = { ...current };
      if (model) next[kind] = model;
      else delete next[kind];
      writeStudioUiPreferences({ agentModelByKind: next });
      return next;
    });
  }, []);

  const handleAskAgent = useCallback(() => {
    const selection = resolveSelection();
    if (!selection) return;
    setAgentPromptTagSnippet(undefined);
    setAgentPromptSelectionContext(undefined);
    void preloadAgentPromptSnippet(selection);
    setAgentModalOpen(true);
    void refreshAgentState();
    void refreshAgentModels(activeKindRef.current);
  }, [preloadAgentPromptSnippet, refreshAgentModels, refreshAgentState, resolveSelection]);

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
          agent: selectedAgentKind ?? undefined,
          model: activeKindRef.current ? modelByKind[activeKindRef.current] : undefined,
          // Selection coordinates travel with the run so the tray can seek back
          // to the moment and re-select the element the agent edited.
          targetRef: {
            sourceFile: selection.sourceFile,
            id: selection.id ?? undefined,
            selector: selection.selector,
            selectorIndex: selection.selectorIndex,
            time: usePlayerStore.getState().currentTime,
          },
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
    [buildPrompt, modelByKind, projectIdRef, resolveSelection, selectedAgentKind, showToast],
  );

  /** Seek to when a run was asked for and re-select the element it edited. */
  const revealAgentJobTarget = useCallback(
    (job: AgentJob) => {
      const ref = job.targetRef;
      if (!ref) return;
      if (typeof ref.time === "number") usePlayerStore.getState().setCurrentTime(ref.time);

      let doc: Document | null = null;
      try {
        doc = previewIframeRef.current?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      const element = doc
        ? findElementForSelection(
            doc,
            {
              sourceFile: ref.sourceFile ?? "",
              id: ref.id,
              selector: ref.selector,
              selectorIndex: ref.selectorIndex,
            },
            activeCompPath,
          )
        : null;
      if (!element) {
        showToast("That element is no longer in the composition.", "error");
        return;
      }
      void buildDomSelectionFromTarget(element, { preferClipAncestor: false }).then((selection) => {
        if (selection) applyDomSelection(selection);
      });
    },
    [activeCompPath, applyDomSelection, buildDomSelectionFromTarget, previewIframeRef, showToast],
  );

  const patchAgentJobs = useCallback(
    (path: string, init: RequestInit) => {
      const pid = projectId ?? projectIdRef.current;
      if (!pid) return;
      void fetch(`/api/projects/${pid}/agent/jobs${path}`, init)
        .then(async (response) => {
          const data = (await response.json()) as { error?: string; jobs?: AgentJob[] };
          if (!response.ok) {
            showToast(data.error ?? "Could not update the queue.", "error");
            return;
          }
          setAgentJobs(data.jobs ?? []);
        })
        .catch(() => showToast("Could not update the queue.", "error"));
    },
    [projectId, projectIdRef, showToast],
  );

  /** Reorder a waiting run; `position` indexes the queue, 0 is next up. */
  const moveAgentJob = useCallback(
    (jobId: string, position: number) =>
      patchAgentJobs(`/${jobId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ position }),
      }),
    [patchAgentJobs],
  );

  /** Drop a queued run, or stop one that is already going. */
  const cancelAgentJob = useCallback(
    (jobId: string) => patchAgentJobs(`/${jobId}`, { method: "DELETE" }),
    [patchAgentJobs],
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

  // Fast while something is in flight, slow otherwise — a run can also be
  // started from another tab or the CLI, and the tray should still notice.
  const hasActiveJob = agentJobs.some((job) => job.status === "queued" || job.status === "running");
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const timer = setInterval(() => void refreshAgentState(), hasActiveJob ? 1200 : 8000);
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

  // What every agent affordance should say: the user's pick when they made one,
  // else whatever the server auto-detected. Menus, the inspector footer and the
  // composer all read this, so they can never disagree about who will run.
  const activeAgent = agentOptions.find((option) => option.kind === selectedAgentKind);
  const activeKind = activeAgent?.kind ?? agentRunKind;
  activeKindRef.current = activeKind;

  return {
    // State
    agentModalOpen,
    copiedAgentPrompt,
    agentPromptSelectionContext,
    agentRunLabel: activeAgent?.label ?? agentRunLabel,
    agentRunKind: activeAgent?.kind ?? agentRunKind,
    agentIconUrl,
    agentOptions,
    agentModels,
    selectedModel: activeKind ? (modelByKind[activeKind] ?? null) : null,
    selectedAgentKind,
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
    moveAgentJob,
    cancelAgentJob,
    revealAgentJobTarget,
    setSelectedAgentKind,
    setSelectedModel,
    refreshAgentModels,
  };
}
