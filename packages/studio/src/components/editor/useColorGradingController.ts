import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  HF_COLOR_GRADING_ATTR,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  serializeHfColorGrading,
  type HfColorGradingTarget,
  type NormalizedHfColorGrading,
} from "@hyperframes/core/color-grading";
import {
  addStudioPendingEditFlushListener,
  trackStudioPendingEdit,
} from "../../utils/studioPendingEdits";
import type { DomEditSelection } from "./domEditing";
import { stripQueryAndHash } from "./propertyPanelHelpers";
import {
  acceptStudioRuntimeMessage,
  postRuntimeControlMessage,
} from "../../player/lib/runtimeProtocol";

const COLOR_GRADING_DATA_KEY = HF_COLOR_GRADING_ATTR.replace(/^data-/, "");
const RUNTIME_STATUS_REFRESH_DELAYS = [50, 250, 1000, 2500] as const;
const MEDIA_METADATA_CACHE = new Map<string, MediaMetadata | null>();

export interface RuntimeColorGradingStatus {
  state: "missing" | "inactive" | "pending" | "active" | "unavailable";
  message: string;
}

export interface MediaMetadata {
  kind: "video" | "image" | "audio" | "unknown";
  color: {
    dynamicRange: "hdr" | "sdr" | "unknown";
    hdrTransfer: "pq" | "hlg" | "unknown" | null;
    label: string;
    isHdr: boolean;
    codecName?: string;
    profile?: string;
    pixelFormat?: string;
    colorSpace?: string;
    colorTransfer?: string;
    colorPrimaries?: string;
  };
  probeError?: string;
}

interface MediaMetadataResponse {
  path: string;
  metadata: MediaMetadata;
}

function stripPreviewAssetPath(src: string, projectId: string): string | null {
  let pathname = src;
  try {
    pathname = new URL(src, window.location.href).pathname;
  } catch {
    return null;
  }
  const projectMarker = `/api/projects/${encodeURIComponent(projectId)}/preview/`;
  const genericMarker = "/preview/";
  const marker = pathname.includes(projectMarker) ? projectMarker : genericMarker;
  const index = pathname.indexOf(marker);
  if (index < 0) return null;
  const assetPath = decodeURIComponent(pathname.slice(index + marker.length)).replace(/^\/+/, "");
  if (!assetPath || assetPath.startsWith("comp/")) return null;
  return assetPath;
}

// fallow-ignore-next-line complexity
function resolveProjectAssetPath(
  sourceFile: string,
  src: string,
  projectId: string,
): string | null {
  const trimmed = stripQueryAndHash(src.trim());
  if (!trimmed || /^(?:data:|blob:)/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return stripPreviewAssetPath(trimmed, projectId);
  if (trimmed.startsWith("/")) {
    return stripPreviewAssetPath(trimmed, projectId);
  }

  const sourceDir = sourceFile.includes("/")
    ? sourceFile.slice(0, sourceFile.lastIndexOf("/"))
    : "";
  const parts = `${sourceDir}/${trimmed}`.split("/");
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/") || null;
}

function selectedMediaAssetPath(element: DomEditSelection, projectId: string): string | null {
  if (element.tagName !== "video" && element.tagName !== "img") return null;
  const media = element.element as HTMLImageElement | HTMLVideoElement;
  const src = media.getAttribute("src") || media.currentSrc || "";
  return resolveProjectAssetPath(element.sourceFile || "index.html", src, projectId);
}

function defaultColorGrading(): NormalizedHfColorGrading {
  const grading = normalizeHfColorGrading("neutral");
  if (!grading) throw new Error("Missing neutral color grading preset");
  return grading;
}

function readColorGradingFromElement(element: DomEditSelection): NormalizedHfColorGrading {
  return (
    normalizeHfColorGrading(element.dataAttributes[COLOR_GRADING_DATA_KEY]) ?? defaultColorGrading()
  );
}

function toBridgeColorGrading(grading: NormalizedHfColorGrading): unknown {
  if (!isHfColorGradingActive(grading)) return null;
  const { enabled: _enabled, ...bridgeGrading } = grading;
  return bridgeGrading;
}

function readRuntimeColorGradingStatus(
  iframe: HTMLIFrameElement | null | undefined,
  target: HfColorGradingTarget,
): RuntimeColorGradingStatus {
  try {
    const win = iframe?.contentWindow as
      | (Window & {
          __hf?: {
            colorGrading?: {
              getStatus?: (
                target: HfColorGradingTarget | string | null | undefined,
              ) => RuntimeColorGradingStatus;
            };
          };
        })
      | null
      | undefined;
    const status = win?.__hf?.colorGrading?.getStatus?.(target);
    return status ?? { state: "pending", message: "Waiting for runtime" };
  } catch {
    return { state: "unavailable", message: "Preview unavailable" };
  }
}

export interface ColorGradingControllerState {
  grading: NormalizedHfColorGrading;
  compareEnabled: boolean;
  applyScope: "source-file" | "project";
  applyBusy: boolean;
  runtimeStatus: RuntimeColorGradingStatus;
  mediaMetadata: MediaMetadata | null;
  commitColorGrading: (next: NormalizedHfColorGrading) => void;
  commitCompare: (enabled: boolean) => void;
  setApplyScope: (scope: "source-file" | "project") => void;
  applyToScope: () => Promise<void>;
  resetGrading: () => void;
}

export function useColorGradingController({
  projectId,
  element,
  previewIframeRef,
  onSetAttributeLive,
  onApplyScope,
}: {
  projectId: string;
  element: DomEditSelection;
  previewIframeRef?: RefObject<HTMLIFrameElement | null>;
  onSetAttributeLive: (attr: string, value: string | null) => void | Promise<void>;
  onApplyScope?: (
    scope: "source-file" | "project",
    value: string | null,
  ) => Promise<{ changedFiles: number; changedElements: number }>;
}): ColorGradingControllerState {
  const [grading, setGrading] = useState(() => readColorGradingFromElement(element));
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [applyScope, setApplyScope] = useState<"source-file" | "project">("source-file");
  const [applyBusy, setApplyBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeColorGradingStatus>(() => ({
    state: "pending",
    message: "Waiting for runtime",
  }));
  const selectedAssetPath = useMemo(
    () => selectedMediaAssetPath(element, projectId),
    [element, projectId],
  );
  const [mediaMetadata, setMediaMetadata] = useState<MediaMetadata | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistValueRef = useRef<string | null | undefined>(undefined);
  const statusTimersRef = useRef<number[]>([]);
  const onSetAttributeLiveRef = useRef(onSetAttributeLive);
  const latestGradingRef = useRef(grading);
  const compareEnabledRef = useRef(compareEnabled);
  onSetAttributeLiveRef.current = onSetAttributeLive;
  latestGradingRef.current = grading;
  compareEnabledRef.current = compareEnabled;
  const target = useMemo(
    (): HfColorGradingTarget => ({
      id: element.id ?? null,
      hfId: element.hfId ?? null,
      selector: element.selector ?? null,
      selectorIndex: element.selectorIndex ?? null,
    }),
    [element.hfId, element.id, element.selector, element.selectorIndex],
  );

  const refreshRuntimeStatus = useCallback(() => {
    setRuntimeStatus(readRuntimeColorGradingStatus(previewIframeRef?.current, target));
  }, [previewIframeRef, target]);

  useEffect(() => {
    setMediaMetadata(null);
    if (!selectedAssetPath) return;
    const cacheKey = `${projectId}:${selectedAssetPath}`;
    if (MEDIA_METADATA_CACHE.has(cacheKey)) {
      setMediaMetadata(MEDIA_METADATA_CACHE.get(cacheKey) ?? null);
      return;
    }
    const controller = new AbortController();
    fetch(
      `/api/projects/${encodeURIComponent(projectId)}/media/metadata?path=${encodeURIComponent(
        selectedAssetPath,
      )}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data: MediaMetadataResponse | null) => {
        if (controller.signal.aborted) return;
        const metadata = data?.metadata ?? null;
        MEDIA_METADATA_CACHE.set(cacheKey, metadata);
        setMediaMetadata(metadata);
      })
      .catch(() => {
        if (!controller.signal.aborted) MEDIA_METADATA_CACHE.set(cacheKey, null);
      });
    return () => controller.abort();
  }, [projectId, selectedAssetPath]);

  const clearStatusTimers = useCallback(() => {
    for (const timer of statusTimersRef.current) clearTimeout(timer);
    statusTimersRef.current = [];
  }, []);

  const scheduleRuntimeStatusRefresh = useCallback(() => {
    clearStatusTimers();
    statusTimersRef.current = RUNTIME_STATUS_REFRESH_DELAYS.map((delay) =>
      window.setTimeout(refreshRuntimeStatus, delay),
    );
  }, [clearStatusTimers, refreshRuntimeStatus]);

  useEffect(() => {
    refreshRuntimeStatus();
  }, [refreshRuntimeStatus]);

  const persistColorGradingValue = useCallback((value: string | null) => {
    return trackStudioPendingEdit(
      onSetAttributeLiveRef.current(COLOR_GRADING_DATA_KEY, value ?? null),
    );
  }, []);

  const flushPendingPersist = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (pendingPersistValueRef.current === undefined) return undefined;
    const value = pendingPersistValueRef.current;
    pendingPersistValueRef.current = undefined;
    return persistColorGradingValue(value);
  }, [persistColorGradingValue]);

  useEffect(() => addStudioPendingEditFlushListener(flushPendingPersist), [flushPendingPersist]);

  useEffect(() => {
    return () => {
      clearStatusTimers();
      void flushPendingPersist();
    };
  }, [clearStatusTimers, flushPendingPersist]);

  const postColorGrading = useCallback(
    (nextGrading: NormalizedHfColorGrading) => {
      postRuntimeControlMessage(previewIframeRef?.current?.contentWindow, "set-color-grading", {
        target,
        grading: toBridgeColorGrading(nextGrading),
      });
    },
    [previewIframeRef, target],
  );

  const postCompare = useCallback(
    (enabled: boolean) => {
      postRuntimeControlMessage(
        previewIframeRef?.current?.contentWindow,
        "set-color-grading-compare",
        {
          target,
          compare: { enabled, position: 1, lineWidth: 0 },
        },
      );
    },
    [previewIframeRef, target],
  );

  useEffect(() => {
    const iframe = previewIframeRef?.current;
    if (!iframe) return;
    const refreshAndReplay = () => {
      const nextGrading = latestGradingRef.current;
      const active = isHfColorGradingActive(nextGrading);
      if (active) postColorGrading(nextGrading);
      postCompare(compareEnabledRef.current && active);
      scheduleRuntimeStatusRefresh();
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (data?.source !== "hf-preview" || data.type !== "ready") return;
      if (!acceptStudioRuntimeMessage(data)) return;
      refreshAndReplay();
    };
    iframe.addEventListener("load", refreshAndReplay);
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(refreshAndReplay, 80);
    return () => {
      iframe.removeEventListener("load", refreshAndReplay);
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [postColorGrading, postCompare, previewIframeRef, scheduleRuntimeStatusRefresh]);

  useEffect(
    () => () => {
      postCompare(false);
    },
    [postCompare],
  );

  const commitColorGrading = useCallback(
    (nextGrading: NormalizedHfColorGrading) => {
      setGrading(nextGrading);
      setRuntimeStatus({ state: "pending", message: "Updating shader" });
      postColorGrading(nextGrading);
      const active = isHfColorGradingActive(nextGrading);
      if (compareEnabledRef.current) {
        postCompare(active);
        if (!active) setCompareEnabled(false);
      }
      scheduleRuntimeStatusRefresh();
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      pendingPersistValueRef.current = isHfColorGradingActive(nextGrading)
        ? serializeHfColorGrading(nextGrading)
        : null;
      persistTimerRef.current = setTimeout(() => {
        const value = pendingPersistValueRef.current;
        pendingPersistValueRef.current = undefined;
        persistTimerRef.current = null;
        void persistColorGradingValue(value ?? null);
      }, 350);
    },
    [persistColorGradingValue, postColorGrading, postCompare, scheduleRuntimeStatusRefresh],
  );

  const commitCompare = useCallback(
    (enabled: boolean) => {
      const nextEnabled = enabled && isHfColorGradingActive(grading);
      setCompareEnabled(nextEnabled);
      if (nextEnabled) postColorGrading(grading);
      postCompare(nextEnabled);
      scheduleRuntimeStatusRefresh();
    },
    [grading, postColorGrading, postCompare, scheduleRuntimeStatusRefresh],
  );

  const applyToScope = useCallback(async () => {
    if (!onApplyScope || applyBusy) return;
    setApplyBusy(true);
    try {
      const value = isHfColorGradingActive(grading) ? serializeHfColorGrading(grading) : null;
      await onApplyScope(applyScope, value);
    } finally {
      setApplyBusy(false);
    }
  }, [applyBusy, applyScope, grading, onApplyScope]);

  return {
    grading,
    compareEnabled,
    applyScope,
    applyBusy,
    runtimeStatus,
    mediaMetadata,
    commitColorGrading,
    commitCompare,
    setApplyScope,
    applyToScope,
    resetGrading: () => commitColorGrading(defaultColorGrading()),
  };
}
