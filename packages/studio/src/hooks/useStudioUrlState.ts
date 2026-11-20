import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayerStore } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { SelectionLookupTarget } from "../components/editor/domEditSelectionRules";
import { findSelectionElement } from "../components/editor/previewSelection";
import type { PreviewElement } from "../player/lib/previewElements";
import type { MarqueeSelectionMode } from "../utils/marqueeGeometry";
import { clampNumber, type RightPanelTab } from "../utils/studioHelpers";
import { parseProjectIdFromHash } from "../utils/projectRouting";
import {
  buildStudioHash,
  parseStudioUrlStateFromHash,
  type StudioUrlSelectionState,
  type StudioUrlSelectionTarget,
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
  domEditGroupSelections: DomEditSelection[];
  applyMarqueeSelection: (selections: DomEditSelection[], mode: MarqueeSelectionMode) => void;
  buildDomSelectionFromTarget: (
    target: HTMLElement | PreviewElement,
    options?: { preferClipAncestor?: boolean; skipSourceProbe?: boolean },
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
  initialState: StudioUrlState;
}

function toPersistedTarget(selection: DomEditSelection): StudioUrlSelectionTarget | null {
  if (!selection.id && !selection.selector) return null;
  return {
    sourceFile: selection.sourceFile || undefined,
    id: selection.id || undefined,
    selector: selection.selector || undefined,
    selectorIndex: selection.selectorIndex ?? undefined,
  };
}

function selectionTargetKey(selection: StudioUrlSelectionTarget): string {
  return [
    selection.sourceFile ?? "",
    selection.id ?? "",
    selection.selector ?? "",
    selection.selectorIndex ?? "",
  ].join("|");
}

function toPersistedSelection(
  selection: DomEditSelection | null,
  // Optional: a caller that only ever has one selection has nothing to add, and
  // the URL must still carry that one rather than throwing on the way out.
  group: DomEditSelection[] = [],
): StudioUrlSelectionState | null {
  if (!selection) return null;
  const primary = toPersistedTarget(selection);
  if (!primary) return null;
  // The primary is already carried by the top-level fields; the rest ride along so the link
  // reopens the same multi-selection instead of a single element.
  const primaryKey = selectionTargetKey(primary);
  const members = new Map<string, StudioUrlSelectionTarget>();
  for (const member of group) {
    const target = toPersistedTarget(member);
    if (!target) continue;
    const key = selectionTargetKey(target);
    if (key !== primaryKey) members.set(key, target);
  }
  return {
    ...primary,
    group: members.size > 0 ? [...members.values()] : undefined,
  };
}

// A frame still loading cannot answer a lookup yet: it is asked again this often, this many times (about 10 s).
const URL_SELECTION_RETRY_MS = 250;
const URL_SELECTION_TRIES = 40;

function replaceHash(nextHash: string) {
  if (typeof window === "undefined") return;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(null, "", nextHash);
}

type UrlSelectionFound = HTMLElement | PreviewElement | null | undefined;

interface ResolveUrlSelectionsParams {
  find: (target: SelectionLookupTarget) => Promise<UrlSelectionFound>;
  selection: StudioUrlSelectionState;
  group: StudioUrlSelectionTarget[];
  isCurrent: () => boolean;
  buildDomSelection: UseStudioUrlStateParams["buildDomSelectionFromTarget"];
}

function urlLookupTarget(
  target: StudioUrlSelectionTarget,
  fallbackSourceFile: string,
): SelectionLookupTarget {
  return {
    sourceFile: target.sourceFile ?? fallbackSourceFile,
    id: target.id,
    selector: target.selector,
    selectorIndex: target.selectorIndex,
  };
}

async function buildOptionalDomSelection(
  element: HTMLElement | PreviewElement | null | undefined,
  buildDomSelection: UseStudioUrlStateParams["buildDomSelectionFromTarget"],
): Promise<DomEditSelection | null> {
  if (!element) return null;
  // No source probe for group members. Each one costs a request, they are
  // resolved one after another, and the URL carries the whole selection — so a
  // marquee over a captured page turned every reload into hundreds of serial
  // round trips before the canvas answered anything, including a Delete press.
  // The marquee that produced these members already skips the probe for the
  // same reason; only the primary, whose panel reads the flag, still pays it.
  return buildDomSelection(element, { preferClipAncestor: false, skipSourceProbe: true });
}

export async function resolveUrlSelections({
  find,
  selection,
  group,
  isCurrent,
  buildDomSelection,
}: ResolveUrlSelectionsParams): Promise<DomEditSelection[] | null | undefined> {
  const found = await find(urlLookupTarget(selection, ""));
  if (!isCurrent()) return null;
  if (found === undefined) return undefined;
  const primary = found && (await buildDomSelection(found, { preferClipAncestor: false }));
  if (!isCurrent()) return null;
  if (!primary) return [];
  const members = [primary];
  for (const member of group) {
    const element = await find(urlLookupTarget(member, selection.sourceFile ?? ""));
    if (!isCurrent()) return null;
    // A member the frame cannot answer for yet is not missing: the whole lookup waits for it.
    if (element === undefined) return undefined;
    const resolved = await buildOptionalDomSelection(element, buildDomSelection);
    if (!isCurrent()) return null;
    if (resolved) members.push(resolved);
  }
  return members;
}

interface UrlSelectionLookup extends ResolveUrlSelectionsParams {
  apply: (members: DomEditSelection[]) => void;
  settle: () => void;
  retry: (next: () => void) => void;
}

function lookUpUrlSelection(lookup: UrlSelectionLookup, triesLeft = URL_SELECTION_TRIES): void {
  void resolveUrlSelections(lookup).then((members) => {
    if (members === undefined && triesLeft > 1) {
      lookup.retry(() => lookUpUrlSelection(lookup, triesLeft - 1));
      return;
    }
    if (members) lookup.apply(members);
    lookup.settle();
  });
}

function applyUrlMembers(
  members: DomEditSelection[],
  grouped: boolean,
  applyDomSelection: (
    selection: DomEditSelection | null,
    options: { revealPanel: boolean },
  ) => void,
  applyMarqueeSelection: (selections: DomEditSelection[], mode: MarqueeSelectionMode) => void,
): void {
  const primary = members[0];
  if (!primary) return applyDomSelection(null, { revealPanel: false });
  if (!grouped) return applyDomSelection(primary, { revealPanel: false });
  // Missing group members are dropped without failing the rest.
  applyMarqueeSelection(members, "replace");
}

// One URL-selection lookup at a time: a newer one replaces the older, which ends then.
interface UrlLookupState {
  applySeq: number;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  pendingSettle: (() => void) | undefined;
  hydrating: boolean;
}

function useUrlLookupState(): UrlLookupState {
  const state = useRef<UrlLookupState>({
    applySeq: 0,
    retryTimer: undefined,
    pendingSettle: undefined,
    hydrating: false,
  }).current;
  useEffect(() => () => clearTimeout(state.retryTimer), [state]);
  return state;
}

function endOnce(state: UrlLookupState, onSettled?: () => void): () => void {
  let ended = false;
  const settle = () => {
    if (ended) return;
    ended = true;
    if (state.pendingSettle === settle) state.pendingSettle = undefined;
    onSettled?.();
  };
  return settle;
}

interface UrlSelectionHost {
  iframe: HTMLIFrameElement | null;
  activeCompPath: string | null;
  lookup: UrlLookupState;
  buildDomSelection: ResolveUrlSelectionsParams["buildDomSelection"];
  applyDomSelection: (
    selection: DomEditSelection | null,
    options: { revealPanel: boolean },
  ) => void;
  applyMarqueeSelection: (selections: DomEditSelection[], mode: MarqueeSelectionMode) => void;
}

// Resolve a URL selection in the preview, sealed or not, and apply it. False when there is no preview yet; a frame
// that cannot answer yet is asked again on a timer. onSettled runs once the lookup ends, however it ends.
function startUrlSelection(
  host: UrlSelectionHost,
  selection: StudioUrlSelectionState | null,
  onSettled?: () => void,
): boolean {
  const { iframe } = host;
  if (selection && !iframe) return false;
  const { lookup } = host;
  clearTimeout(lookup.retryTimer);
  const applySeq = ++lookup.applySeq;
  lookup.pendingSettle?.();
  const settle = endOnce(lookup, onSettled);
  lookup.pendingSettle = settle;
  if (!selection || !iframe) {
    host.applyDomSelection(null, { revealPanel: false });
    settle();
    return true;
  }
  const group = selection.group ?? [];
  lookUpUrlSelection({
    find: (target) => findSelectionElement(iframe, target, host.activeCompPath),
    selection,
    group,
    isCurrent: () => applySeq === lookup.applySeq,
    buildDomSelection: host.buildDomSelection,
    apply: (members) =>
      applyUrlMembers(
        members,
        group.length > 0,
        host.applyDomSelection,
        host.applyMarqueeSelection,
      ),
    settle,
    retry: (next) => {
      lookup.retryTimer = setTimeout(next, URL_SELECTION_RETRY_MS);
    },
  });
  return true;
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
  domEditGroupSelections,
  applyMarqueeSelection,
  buildDomSelectionFromTarget,
  applyDomSelection,
  setRightPanelTab,
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
  const urlLookup = useUrlLookupState();

  const buildUrlState = useCallback(
    (): StudioUrlState => ({
      activeCompPath,
      currentTime: stableTimeRef.current,
      rightPanelTab,
      rightCollapsed,
      timelineVisible: null,
      selection: hydratedSelectionRef.current
        ? toPersistedSelection(domEditSelection, domEditGroupSelections)
        : pendingSelectionRef.current,
    }),
    [activeCompPath, domEditGroupSelections, domEditSelection, rightCollapsed, rightPanelTab],
  );

  // Shared by the initial hydration effect and the hashchange handler.
  const applyUrlSelection = useCallback(
    (selection: StudioUrlSelectionState | null, onSettled?: () => void): boolean =>
      startUrlSelection(
        {
          iframe: previewIframeRef.current,
          activeCompPath,
          lookup: urlLookup,
          buildDomSelection: buildDomSelectionFromTarget,
          applyDomSelection,
          applyMarqueeSelection,
        },
        selection,
        onSettled,
      ),
    [
      activeCompPath,
      applyDomSelection,
      applyMarqueeSelection,
      buildDomSelectionFromTarget,
      previewIframeRef,
      urlLookup,
    ],
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
    if (!hydratedSeekRef.current || urlLookup.hydrating) return;
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
    // Hydration ends with the lookup, so the URL keeps the selection; no preview yet: a later tick retries.
    const settled = () => {
      urlLookup.hydrating = false;
      markHydrated();
      pendingSelectionRef.current = null;
    };
    urlLookup.hydrating = applyUrlSelection(pendingSelection, settled);
  }, [
    applyUrlSelection,
    compositionLoading,
    selectionHydrationTime,
    initialState.currentTime,
    projectId,
    refreshKey,
    urlLookup,
  ]);

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
