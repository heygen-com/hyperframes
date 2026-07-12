import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { useTimelinePlayer, usePlayerStore } from "../../player";
import type { TimelineElement } from "../../player";
import type { CompositionLevel } from "./CompositionBreadcrumb";
import { useCompositionStack } from "./useCompositionStack";
import { MIN_TIMELINE_H, MIN_PREVIEW_H } from "./TimelineResizeDivider";
import { setCompositionSourceMap } from "../editor/domEditingDom";
import { ensureMotionPathPluginLoaded } from "../../utils/gsapSoftReload";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";

// Timeline gets a generous default height so the preview isn't oversized and the
// tracks have room to breathe (CapCut-style). Users can still drag the divider.
const DEFAULT_TIMELINE_H = 340;

export function shouldDisableTimelineWhileCompositionLoading(compositionLoading: boolean): boolean {
  return compositionLoading;
}

export interface NLEContextValue {
  projectId: string;
  // player (from useTimelinePlayer — single instance for the whole shell)
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  togglePlay: () => void;
  seek: (time: number, options?: { keepPlaying?: boolean }) => boolean;
  refreshPlayer: () => void;
  onIframeLoad: () => void;
  // composition stack (from useCompositionStack)
  compositionStack: CompositionLevel[];
  updateCompositionStack: React.Dispatch<React.SetStateAction<CompositionLevel[]>>;
  handleNavigateComposition: (index: number) => void;
  handleDrillDown: (element: TimelineElement) => void;
  compIdToSrc: Map<string, string>;
  // layout state
  timelineH: number;
  setTimelineH: React.Dispatch<React.SetStateAction<number>>;
  persistTimelineH: (height: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  // composition loading
  compositionLoading: boolean;
  setCompositionLoading: (loading: boolean) => void;
  timelineDisabled: boolean;
  hasLoadedOnceRef: React.MutableRefObject<boolean>;
  // preview composition size (for preview block drop)
  previewCompositionSize: { width: number; height: number } | null;
  setPreviewCompositionSize: (size: { width: number; height: number } | null) => void;
}

const NLEContext = createContext<NLEContextValue | null>(null);

export function useNLEContext(): NLEContextValue {
  const ctx = useContext(NLEContext);
  if (!ctx) throw new Error("useNLEContext must be used within an NLEProvider");
  return ctx;
}

export interface NLEProviderProps {
  projectId: string;
  refreshKey?: number;
  activeCompositionPath?: string | null;
  onIframeRef?: (iframe: HTMLIFrameElement | null) => void;
  onCompositionChange?: (compositionPath: string | null) => void;
  onCompIdToSrcChange?: (map: Map<string, string>) => void;
  onCompositionLoadingChange?: (loading: boolean) => void;
  children: ReactNode;
}

export function NLEProvider({
  projectId,
  refreshKey,
  activeCompositionPath,
  onIframeRef,
  onCompositionChange,
  onCompIdToSrcChange,
  onCompositionLoadingChange,
  children,
}: NLEProviderProps) {
  const {
    iframeRef,
    togglePlay,
    seek,
    onIframeLoad: baseOnIframeLoad,
    refreshPlayer,
  } = useTimelinePlayer();

  // Reset timeline state when the project changes. Done in an effect, not during
  // render: reset() updates the player store, and updating another store/component
  // mid-render triggers React's "Cannot update a component while rendering a
  // different component" warning. The effect runs right after commit, so the new
  // project's first frame may briefly show prior timeline state before it clears.
  //
  // Also clears the asset preview overlay store: it is project-scoped (see its
  // doc-comment) but nothing else clears it on project change — EditorShell isn't
  // keyed by projectId and the overlay stays mounted, so a preview opened in one
  // project would otherwise keep rendering (and re-fetching from) the old project
  // after switching.
  useEffect(() => {
    usePlayerStore.getState().reset();
    useAssetPreviewStore.getState().clearPreviewAsset();
  }, [projectId]);

  // Authored composition size measured from the loaded preview — drives drop
  // coordinate mapping so blocks land where the user pointed on any comp size.
  const [previewCompositionSize, setPreviewCompositionSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Lightweight reload: change iframe src instead of destroying the Player.
  const prevRefreshKeyRef = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === prevRefreshKeyRef.current) return;
    prevRefreshKeyRef.current = refreshKey;
    refreshPlayer();
  }, [refreshKey, refreshPlayer]);

  const onIframeLoad = useCallback(() => {
    baseOnIframeLoad();
    // Pre-load + register MotionPathPlugin once so adding a motion path in the
    // studio doesn't take the async plugin-load flash path on the first soft
    // reload (the comp may not ship the plugin until it actually uses one).
    ensureMotionPathPluginLoaded(iframeRef.current);
    onIframeRef?.(iframeRef.current);
  }, [baseOnIframeLoad, iframeRef, onIframeRef]);

  const {
    compositionStack,
    updateCompositionStack,
    handleNavigateComposition,
    handleDrillDown: drillDown,
    compIdToSrc,
    setCompIdToSrc,
  } = useCompositionStack({
    projectId,
    activeCompositionPath,
    onCompositionChange,
  });

  // Wrap handleDrillDown to also scan the iframe DOM for data-composition-src
  const iframeRef_ = iframeRef;
  const handleDrillDown = useCallback(
    (element: TimelineElement) => {
      if (!element.compositionSrc) return;
      usePlayerStore.getState().setSelectedElementId(null);
      // Check compIdToSrc map first; then scan iframe DOM; then fall through to drillDown
      const compId = element.id;
      let resolvedPath = compIdToSrc.get(compId);
      if (!resolvedPath) {
        try {
          const doc = iframeRef_.current?.contentDocument;
          if (doc) {
            const host = doc.querySelector(
              `[data-composition-id="${CSS.escape(compId)}"][data-composition-src]`,
            );
            if (host) {
              resolvedPath = host.getAttribute("data-composition-src") || undefined;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      // Delegate with the resolved compositionSrc (may be same as original)
      drillDown({
        id: compId,
        compositionSrc: resolvedPath ?? element.compositionSrc,
      });
    },
    [compIdToSrc, drillDown, iframeRef_],
  );

  // Composition ID → file path map from raw index.html
  const compIdToSrcRef = useRef(compIdToSrc);
  compIdToSrcRef.current = compIdToSrc;
  const onCompIdToSrcChangeRef = useRef(onCompIdToSrcChange);
  onCompIdToSrcChangeRef.current = onCompIdToSrcChange;

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const emptyMap = new Map<string, string>();
    setCompIdToSrc(emptyMap);
    setCompositionSourceMap(emptyMap);
    onCompIdToSrcChangeRef.current?.(emptyMap);

    fetch(`/api/projects/${projectId}/files/index.html`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { content?: string }) => {
        if (!current) return;
        const html = data.content || "";
        const map = new Map<string, string>();
        const re =
          /data-composition-id=["']([^"']+)["'][^>]*data-composition-src=["']([^"']+)["']|data-composition-src=["']([^"']+)["'][^>]*data-composition-id=["']([^"']+)["']/g;
        let match;
        while ((match = re.exec(html)) !== null) {
          const id = match[1] || match[4];
          const src = match[2] || match[3];
          if (id && src) map.set(id, src);
        }
        setCompIdToSrc(map);
        // Let DOM source-resolution recover a subcomposition element's source file
        // (the runtime drops the linkage when inlining — see getSourceFileForElement).
        setCompositionSourceMap(map);
        onCompIdToSrcChangeRef.current?.(map);
      })
      .catch((err: unknown) => {
        if (!current || controller.signal.aborted) return;
        // Non-fatal: drill-down still works via the iframe DOM scan; without
        // the map only source-file resolution for sub-comps degrades.
        console.warn("[studio] Couldn't load composition source map from index.html:", err);
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [projectId, setCompIdToSrc]);

  // Patch elements with compositionSrc whenever elements or compIdToSrc change.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (compIdToSrc.size === 0) return;
    const patchElements = (elements: TimelineElement[]): TimelineElement[] | null => {
      const map = compIdToSrcRef.current;
      if (map.size === 0) return null;
      let patched = false;
      const updated = elements.map((el) => {
        if (el.compositionSrc) return el;
        const src = map.get(el.id) ?? map.get(el.id.replace(/-(host|comp|layer)$/, ""));
        if (src) {
          patched = true;
          return { ...el, compositionSrc: src };
        }
        return el;
      });
      return patched ? updated : null;
    };
    const patched = patchElements(usePlayerStore.getState().elements);
    if (patched) usePlayerStore.getState().setElements(patched);
    let patching = false;
    return usePlayerStore.subscribe((state, prev) => {
      if (patching) return;
      if (state.elements === prev.elements || state.elements.length === 0) return;
      if (state.elements.every((el) => el.compositionSrc)) return;
      patching = true;
      const result = patchElements(state.elements);
      if (result) state.setElements(result);
      patching = false;
    });
  }, [compIdToSrc]);

  // Resizable timeline height — persisted alongside zoom/pan so the user's
  // workspace layout survives reloads.
  const [timelineH, setTimelineH] = useState(() => {
    const stored = readStudioUiPreferences().timelineHeight;
    return stored !== undefined && stored >= MIN_TIMELINE_H ? stored : DEFAULT_TIMELINE_H;
  });
  const persistTimelineH = useCallback((height: number) => {
    writeStudioUiPreferences({ timelineHeight: Math.round(height) });
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  // A height persisted on a tall window can exceed this window's container and
  // collapse the flex-1 preview to 0px — clamp once the container is measurable
  // (the drag/keyboard paths already clamp; the restore path must too).
  useEffect(() => {
    const containerH = containerRef.current?.getBoundingClientRect().height;
    if (!containerH) return;
    const max = containerH - MIN_PREVIEW_H;
    setTimelineH((prev) => (prev > max ? Math.max(MIN_TIMELINE_H, max) : prev));
  }, []);

  const hasLoadedOnceRef = useRef(false);
  const [compositionLoading, setCompositionLoadingRaw] = useState(true);
  const setCompositionLoading = useCallback((loading: boolean) => {
    if (!loading) hasLoadedOnceRef.current = true;
    if (loading && hasLoadedOnceRef.current) return;
    setCompositionLoadingRaw(loading);
  }, []);
  const timelineDisabled = shouldDisableTimelineWhileCompositionLoading(compositionLoading);

  useEffect(() => {
    onCompositionLoadingChange?.(compositionLoading);
  }, [compositionLoading, onCompositionLoadingChange]);

  const onIframeRefStable = useRef(onIframeRef);
  onIframeRefStable.current = onIframeRef;
  useEffect(() => {
    onIframeRefStable.current?.(iframeRef.current);
  }, [compositionStack.length, refreshKey, iframeRef]);

  const value: NLEContextValue = {
    projectId,
    iframeRef,
    togglePlay,
    seek,
    refreshPlayer,
    onIframeLoad,
    compositionStack,
    updateCompositionStack,
    handleNavigateComposition,
    handleDrillDown,
    compIdToSrc,
    timelineH,
    setTimelineH,
    persistTimelineH,
    containerRef,
    compositionLoading,
    setCompositionLoading,
    timelineDisabled,
    hasLoadedOnceRef,
    previewCompositionSize,
    setPreviewCompositionSize,
  };

  return <NLEContext.Provider value={value}>{children}</NLEContext.Provider>;
}
