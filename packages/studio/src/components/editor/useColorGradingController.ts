import { mediaMetadataUrl } from "../../utils/studioHelpers";
import { useLivePreviewIframe } from "../../player/store/previewIframeStore";
import { onPreviewContentReplaced } from "../../player/sceneSwap";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  hasHfColorGradingAuthoredValues,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  serializeHfColorGrading,
  type HfColorGradingActiveEffectKey,
  type HfColorGradingTarget,
  type NormalizedHfColorGrading,
} from "@hyperframes/core/color-grading";
import type { DomEditSelection } from "./domEditing";
import { selectionIdentityKey, stripQueryAndHash } from "./propertyPanelHelpers";
import { COLOR_GRADING_DATA_KEY, useColorGradingPersistence } from "./useColorGradingPersistence";
import {
  acceptStudioRuntimeMessage,
  postRuntimeControlMessage,
} from "../../player/lib/runtimeProtocol";
import {
  readSealedColorGradingStatus,
  useColorGradingPreviews,
  type ColorGradingCapturedFrame,
  type ColorGradingPresetPreviews,
  type ColorGradingPreviewOptions,
} from "./useColorGradingPreviews";
import { studioApiFetch } from "../../utils/studioApiFetch";
import { authoredSrcPath } from "../../player/components/thumbnailUtils";
import { previewFrameOpaque } from "../../player/lib/previewChannel";

export type { ColorGradingPresetPreviews, ColorGradingPreviewOptions };

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
  const parts = `${sourceDir}/${authoredSrcPath(trimmed)}`.split("/");
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
  presetPreviews: ColorGradingPresetPreviews;
  effectPreviews: ColorGradingPresetPreviews;
  requestPresetPreviews: () => void;
  requestEffectPreviews: (effects: readonly HfColorGradingActiveEffectKey[]) => void;
  commitColorGrading: (next: NormalizedHfColorGrading) => void;
  previewColorGrading: (
    next: NormalizedHfColorGrading | null,
    options?: ColorGradingPreviewOptions,
  ) => void;
  captureGradedFrame: (options?: {
    grading?: NormalizedHfColorGrading;
  }) => Promise<ColorGradingCapturedFrame | null>;
  commitCompare: (enabled: boolean) => void;
  setApplyScope: (scope: "source-file" | "project") => void;
  applyToScope: () => Promise<void>;
  resetGrading: () => void;
}

export function useColorGradingController({
  projectId,
  element,
  previewIframeRef,
  onSetAttributeQuiet,
  onApplyScope,
}: {
  projectId: string;
  element: DomEditSelection;
  previewIframeRef?: RefObject<HTMLIFrameElement | null>;
  onSetAttributeQuiet: (
    attr: string,
    value: string | null,
    onSettled?: (ok: boolean) => void,
  ) => void | Promise<void>;
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
  // Keep a confirmed value so an optimistic edit can be reverted on failure.
  const confirmedGradingRef = useRef(grading);
  const statusTimersRef = useRef<number[]>([]);
  const latestGradingRef = useRef(grading);
  const compareEnabledRef = useRef(compareEnabled);
  latestGradingRef.current = grading;
  compareEnabledRef.current = compareEnabled;

  // Reset derived state during render to avoid flashing the previous selection.
  const identityKey = selectionIdentityKey(element);
  const identityKeyRef = useRef(identityKey);
  if (identityKeyRef.current !== identityKey) {
    identityKeyRef.current = identityKey;
    const freshGrading = readColorGradingFromElement(element);
    latestGradingRef.current = freshGrading;
    confirmedGradingRef.current = freshGrading;
    setGrading(freshGrading);
    setCompareEnabled(false);
    compareEnabledRef.current = false;
    setApplyScope("source-file");
    setApplyBusy(false);
    setRuntimeStatus({ state: "pending", message: "Waiting for runtime" });
    setMediaMetadata(null);
  }

  const onSaveFailed = useCallback((reverted: NormalizedHfColorGrading) => {
    latestGradingRef.current = reverted;
    setGrading(reverted);
    setRuntimeStatus({ state: "unavailable", message: "Save failed, changes reverted" });
  }, []);
  const { schedulePersist, isPersistPending } = useColorGradingPersistence({
    identityKey,
    identityKeyRef,
    latestGradingRef,
    confirmedGradingRef,
    onSetAttributeQuiet,
    onSaveFailed,
  });

  const authoredGrading = element.dataAttributes[COLOR_GRADING_DATA_KEY] ?? null;
  const authoredGradingRef = useRef(authoredGrading);
  if (authoredGradingRef.current !== authoredGrading) {
    authoredGradingRef.current = authoredGrading;
    const fromElement = readColorGradingFromElement(element);
    if (
      !isPersistPending() &&
      serializeHfColorGrading(fromElement) !== serializeHfColorGrading(latestGradingRef.current)
    ) {
      latestGradingRef.current = fromElement;
      confirmedGradingRef.current = fromElement;
      setGrading(fromElement);
    }
  }

  useEffect(() => {
    return () => {
      for (const timer of statusTimersRef.current) clearTimeout(timer);
      statusTimersRef.current = [];
    };
  }, [identityKey]);

  const target = useMemo(
    (): HfColorGradingTarget => ({
      id: element.id ?? null,
      hfId: element.hfId ?? null,
      selector: element.selector ?? null,
      selectorIndex: element.selectorIndex ?? null,
    }),
    [element.hfId, element.id, element.selector, element.selectorIndex],
  );

  const statusReadRef = useRef(0);
  const refreshRuntimeStatus = useCallback(() => {
    refreshStatus(previewIframeRef?.current, target, statusReadRef, setRuntimeStatus);
  }, [previewIframeRef, target]);

  useEffect(() => {
    setMediaMetadata(null);
    if (!selectedAssetPath) return;
    const cacheKey = mediaMetadataUrl(projectId, selectedAssetPath);
    if (MEDIA_METADATA_CACHE.has(cacheKey)) {
      setMediaMetadata(MEDIA_METADATA_CACHE.get(cacheKey) ?? null);
      return;
    }
    const controller = new AbortController();
    studioApiFetch(cacheKey, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return { ok: false as const };
        const data: MediaMetadataResponse | null = await response.json();
        return { ok: true as const, metadata: data?.metadata ?? null };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        // Cache only successful responses so transient failures remain retryable.
        if (!result.ok) {
          setMediaMetadata(null);
          return;
        }
        MEDIA_METADATA_CACHE.set(cacheKey, result.metadata);
        setMediaMetadata(result.metadata);
      })
      .catch(() => {
        if (!controller.signal.aborted) setMediaMetadata(null);
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

  useEffect(() => () => clearStatusTimers(), [clearStatusTimers]);

  const postColorGrading = useCallback(
    (nextGrading: NormalizedHfColorGrading) => {
      postRuntimeControlMessage(previewIframeRef?.current?.contentWindow, "set-color-grading", {
        target,
        grading: toBridgeColorGrading(nextGrading),
      });
    },
    [previewIframeRef, target],
  );
  const previewController = useColorGradingPreviews({
    grading,
    gradingRef: latestGradingRef,
    identityKey,
    target,
    previewIframeRef,
    postColorGrading,
  });

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

  const livePreviewIframe = useLivePreviewIframe();
  useEffect(() => {
    const iframe = previewIframeRef?.current;
    if (!iframe) return;
    const refreshAndReplay = () => {
      const nextGrading = latestGradingRef.current;
      const active = isHfColorGradingActive(nextGrading);
      const notInTheFileYet =
        serializeHfColorGrading(nextGrading) !==
        serializeHfColorGrading(confirmedGradingRef.current);
      if (notInTheFileYet) postColorGrading(nextGrading);
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
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(refreshAndReplay, 80);
    const stopReplay = onPreviewContentReplaced(iframe, refreshAndReplay);
    return () => {
      stopReplay();
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [
    postColorGrading,
    postCompare,
    previewIframeRef,
    scheduleRuntimeStatusRefresh,
    livePreviewIframe,
  ]);

  useEffect(
    () => () => {
      postCompare(false);
    },
    [postCompare],
  );

  const commitColorGrading = useCallback(
    (nextGrading: NormalizedHfColorGrading) => {
      latestGradingRef.current = nextGrading;
      setGrading(nextGrading);
      setRuntimeStatus({ state: "pending", message: "Updating shader" });
      postColorGrading(nextGrading);
      const active = isHfColorGradingActive(nextGrading);
      if (compareEnabledRef.current) {
        postCompare(active);
        if (!active) setCompareEnabled(false);
      }
      scheduleRuntimeStatusRefresh();
      schedulePersist(nextGrading);
    },
    [postColorGrading, postCompare, schedulePersist, scheduleRuntimeStatusRefresh],
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
      const value = hasHfColorGradingAuthoredValues(grading)
        ? serializeHfColorGrading(grading)
        : null;
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
    presetPreviews: previewController.presetPreviews,
    effectPreviews: previewController.effectPreviews,
    requestPresetPreviews: previewController.requestPresetPreviews,
    requestEffectPreviews: previewController.requestEffectPreviews,
    commitColorGrading,
    previewColorGrading: previewController.previewColorGrading,
    captureGradedFrame: previewController.captureGradedFrame,
    commitCompare,
    setApplyScope,
    applyToScope,
    resetGrading: () => {
      const neutral = defaultColorGrading();
      commitColorGrading({
        ...neutral,
        lut: latestGradingRef.current.lut,
        effects: latestGradingRef.current.effects,
        palette: latestGradingRef.current.palette,
      });
    },
  };
}

function refreshStatus(
  iframe: HTMLIFrameElement | null | undefined,
  target: HfColorGradingTarget,
  reads: { current: number },
  apply: (status: RuntimeColorGradingStatus) => void,
): void {
  if (!iframe || !previewFrameOpaque(iframe)) {
    apply(readRuntimeColorGradingStatus(iframe, target));
    return;
  }
  const read = ++reads.current;
  void readSealedColorGradingStatus(iframe, target).then((status) => {
    if (read === reads.current) apply(status);
  });
}
