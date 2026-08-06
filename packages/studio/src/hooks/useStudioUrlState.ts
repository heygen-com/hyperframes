import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../player";
import { findElementForSelection, type DomEditSelection } from "../components/editor/domEditing";
import { clampNumber, type RightPanelTab } from "../utils/studioHelpers";
import { parseProjectIdFromHash } from "../utils/projectRouting";
import {
  buildStudioHash,
  parseStudioUrlStateFromHash,
  type StudioUrlSelectionState,
  type StudioUrlState,
} from "../utils/studioUrlState";

interface UseStudioUrlStateParams {
  projectId: string | null;
  activeCompPath: string | null;
  duration: number;
  isPlaying: boolean;
  compositionLoading: boolean;
  refreshKey: number;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  rightPanelTab: RightPanelTab;
  rightCollapsed: boolean;
  activeCompPathHydrated: boolean;
  domEditSelection: DomEditSelection | null;
  buildDomSelectionFromTarget: (
    target: HTMLElement,
    options?: { preferClipAncestor?: boolean },
  ) => Promise<DomEditSelection | null>;
  applyDomSelection: (
    selection: DomEditSelection | null,
    options?: {
      revealPanel?: boolean;
      additive?: boolean;
      preserveGroup?: boolean;
    },
  ) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  /** Whether the agent composer is open, and how to reopen it on a reload. */
  askAgentOpen: boolean;
  openAskAgent: () => void;
  initialState: StudioUrlState;
}

function toPersistedSelection(selection: DomEditSelection | null): StudioUrlSelectionState | null {
  if (!selection) return null;
  if (!selection.id && !selection.selector) return null;
  return {
    sourceFile: selection.sourceFile || undefined,
    id: selection.id || undefined,
    selector: selection.selector || undefined,
    selectorIndex: selection.selectorIndex ?? undefined,
  };
}

function replaceHash(nextHash: string) {
  if (typeof window === "undefined") return;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, "", nextHash);
}

export function useStudioUrlState({
  projectId,
  activeCompPath,
  duration,
  isPlaying,
  compositionLoading,
  refreshKey,
  previewIframeRef,
  rightPanelTab,
  rightCollapsed,
  activeCompPathHydrated,
  domEditSelection,
  buildDomSelectionFromTarget,
  applyDomSelection,
  setRightPanelTab,
  askAgentOpen,
  openAskAgent,
  initialState,
}: UseStudioUrlStateParams) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const hydratedSeekRef = useRef(initialState.currentTime == null);
  const hydratedInitialTimeRef = useRef(initialState.currentTime == null);
  const hydratedSelectionRef = useRef(initialState.selection == null);
  // Mirrors hydratedSelectionRef as state so the selection-hydration effect can
  // drop its currentTime subscription once hydration completes — otherwise it
  // re-runs on every playhead tick for the lifetime of the session.
  const [selectionHydrated, setSelectionHydrated] = useState(initialState.selection == null);
  const pendingSelectionRef = useRef(initialState.selection);
  const stableTimeRef = useRef<number | null>(initialState.currentTime);

  const buildUrlState = useCallback(
    (): StudioUrlState => ({
      activeCompPath,
      currentTime: stableTimeRef.current,
      rightPanelTab,
      rightCollapsed,
      timelineVisible: null,
      selection: hydratedSelectionRef.current
        ? toPersistedSelection(domEditSelection)
        : pendingSelectionRef.current,
      askAgentOpen,
    }),
    [activeCompPath, askAgentOpen, domEditSelection, rightCollapsed, rightPanelTab],
  );

  // Resolve a URL selection to a live element and apply it. Shared by the initial
  // hydration effect and the external-navigation (hashchange) handler. Returns
  // false ONLY when the iframe document isn't ready yet (caller should retry);
  // a missing element or null selection clears the selection and returns true.
  const applyUrlSelection = useCallback(
    (
      selection: StudioUrlSelectionState | null,
      options: {
        /** Runs once the element is actually selected, not merely resolved. */
        afterApply?: () => void;
        /**
         * Whether "no such element" should clear the selection. Hydration says
         * yes: the URL named something that is not there. Restoring across a
         * reload says no — the document may simply not have parsed the element
         * yet, and clearing on the first miss is indistinguishable from giving
         * up immediately.
         */
        clearWhenMissing?: boolean;
      } = {},
    ): boolean => {
      const { afterApply, clearWhenMissing = true } = options;
      if (!selection) {
        applyDomSelection(null, { revealPanel: false });
        return true;
      }
      let doc: Document | null = null;
      try {
        doc = previewIframeRef.current?.contentDocument ?? null;
      } catch {
        return false;
      }
      if (!doc) return false;
      const element = findElementForSelection(
        doc,
        {
          sourceFile: selection.sourceFile ?? "",
          id: selection.id,
          selector: selection.selector,
          selectorIndex: selection.selectorIndex,
        },
        activeCompPath,
      );
      if (!element) {
        if (!clearWhenMissing) return false;
        applyDomSelection(null, { revealPanel: false });
        return true;
      }
      void buildDomSelectionFromTarget(element, { preferClipAncestor: false }).then((resolved) => {
        applyDomSelection(resolved, { revealPanel: false });
        if (resolved) afterApply?.();
      });
      return true;
    },
    [activeCompPath, applyDomSelection, buildDomSelectionFromTarget, previewIframeRef],
  );

  useEffect(() => {
    if (!projectId || hydratedSeekRef.current || compositionLoading) return;
    const nextTime =
      duration > 0
        ? clampNumber(initialState.currentTime ?? 0, 0, duration)
        : Math.max(0, initialState.currentTime ?? 0);
    // The request is honored even if it fires before the player runtime mounts:
    // initializeAdapter reconciles the store's requestedSeekTime when the adapter
    // becomes ready. currentTime then settles to nextTime, releasing the selection
    // hydration below.
    usePlayerStore.getState().requestSeek(nextTime);
    stableTimeRef.current = nextTime;
    hydratedSeekRef.current = true;
  }, [projectId, compositionLoading, duration, initialState.currentTime]);

  // Once hydration completes the selection effect no longer needs the playhead,
  // so freeze its time dependency. This stops the effect re-running on every tick
  // for the rest of the session (cosmetic perf) while still retrying as the seek
  // settles before hydration.
  const selectionHydrationTime = selectionHydrated ? 0 : currentTime;
  useEffect(() => {
    if (!projectId || hydratedSelectionRef.current || compositionLoading) return;
    if (!hydratedSeekRef.current) return;
    const targetTime = initialState.currentTime;
    if (targetTime != null && Math.abs(selectionHydrationTime - stableTimeRef.current!) > 0.05) {
      return;
    }

    const markHydrated = () => {
      hydratedSelectionRef.current = true;
      setSelectionHydrated(true);
    };
    const pendingSelection = pendingSelectionRef.current;
    if (!pendingSelection) {
      markHydrated();
      return;
    }
    // The composer belongs to an element, so it comes back only once that
    // element does — reopening earlier would open it on nothing. An agent's
    // edit reloads Studio mid-sentence and the draft already survives; this is
    // what puts the box back around it.
    const reopenComposer = () => {
      if (initialState.askAgentOpen) openAskAgent();
    };
    // Doc not ready yet → leave hydration pending so a later tick retries.
    if (!applyUrlSelection(pendingSelection, { afterApply: reopenComposer })) return;
    markHydrated();
    pendingSelectionRef.current = null;
  }, [
    applyUrlSelection,
    compositionLoading,
    selectionHydrationTime,
    initialState.askAgentOpen,
    initialState.currentTime,
    openAskAgent,
    projectId,
    refreshKey,
  ]);

  // ── Keep the selection across a preview reload ──
  // The reload swaps in a new document, so the selected element is a node that
  // no longer exists and the selection clears itself. An agent's edit reloads
  // the preview on every run, and losing the selection there loses the element
  // the user is working on — and, with it, everything keyed to the selection:
  // the inspector, the composer, and the selection in the URL.
  const lastSelectionRef = useRef<StudioUrlSelectionState | null>(null);
  useEffect(() => {
    const persisted = toPersistedSelection(domEditSelection);
    if (persisted) lastSelectionRef.current = persisted;
  }, [domEditSelection]);

  // Read through a ref: applyUrlSelection is rebuilt whenever the selection
  // changes, so an effect depending on it would tear down its own retry loop
  // the moment the first restore landed.
  const applyUrlSelectionRef = useRef(applyUrlSelection);
  applyUrlSelectionRef.current = applyUrlSelection;

  useEffect(() => {
    const target = lastSelectionRef.current;
    if (!target) return;

    // The new document is not parsed when the reload is announced, and
    // applyUrlSelection reports that by returning false, so retry until it is.
    let attempts = 0;
    const retry = setInterval(() => {
      attempts += 1;
      // The user selecting something else mid-reload wins: it is a newer
      // intention than the one being restored.
      const abandoned = lastSelectionRef.current !== target;
      const restored = applyUrlSelectionRef.current(target, { clearWhenMissing: false });
      if (abandoned || restored || attempts > 40) clearInterval(retry);
    }, 100);
    return () => clearInterval(retry);
  }, [refreshKey]);

  useEffect(() => {
    if (hydratedInitialTimeRef.current) return;
    const targetTime = stableTimeRef.current;
    if (targetTime == null) {
      hydratedInitialTimeRef.current = true;
      return;
    }
    if (Math.abs(currentTime - targetTime) > 0.05) return;
    hydratedInitialTimeRef.current = true;
  }, [currentTime]);

  useEffect(() => {
    if (!activeCompPathHydrated) return;
    if (!hydratedSeekRef.current) return;
    if (!hydratedInitialTimeRef.current) return;
    if (!projectId || isPlaying) return;
    const handle = window.setTimeout(() => {
      stableTimeRef.current = clampNumber(currentTime, 0, Math.max(0, duration));
      replaceHash(buildStudioHash(projectId, buildUrlState()));
    }, 200);

    return () => window.clearTimeout(handle);
  }, [activeCompPathHydrated, buildUrlState, currentTime, duration, isPlaying, projectId]);

  useEffect(() => {
    if (!activeCompPathHydrated) return;
    if (!projectId) return;
    replaceHash(buildStudioHash(projectId, buildUrlState()));
  }, [activeCompPathHydrated, buildUrlState, projectId]);

  // Re-apply URL state when the hash changes externally (pasting a new link,
  // back/forward) AFTER initial load. The app only reads the URL once on mount
  // and otherwise WRITES the hash via replaceState (which never fires
  // `hashchange`), so this listener sees only genuine external navigations —
  // without it, opening a same-project deep link (different `t`, element, or
  // tab) is silently ignored and then overwritten by the next hash-sync.
  useEffect(() => {
    if (!projectId) return;
    const onHashChange = () => {
      if (parseProjectIdFromHash(window.location.hash) !== projectId) return; // different project → remount handles it
      const parsed = parseStudioUrlStateFromHash(window.location.hash);
      if (parsed.currentTime != null) {
        const clamped =
          duration > 0
            ? clampNumber(parsed.currentTime, 0, duration)
            : Math.max(0, parsed.currentTime);
        if (Math.abs(usePlayerStore.getState().currentTime - clamped) > 0.05) {
          usePlayerStore.getState().requestSeek(clamped);
          stableTimeRef.current = clamped;
        }
      }
      applyUrlSelection(parsed.selection);
      if (parsed.rightPanelTab) setRightPanelTab(parsed.rightPanelTab);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [projectId, duration, applyUrlSelection, setRightPanelTab]);
}
