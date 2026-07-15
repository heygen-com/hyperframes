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
import { selectionIdentityKey, stripQueryAndHash } from "./propertyPanelHelpers";
import { bumpDomEditCommitVersion } from "../../hooks/domEditCommitRunner";
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
  onSetAttributeLive: (
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
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistValueRef = useRef<string | null | undefined>(undefined);
  const pendingPersistGradingRef = useRef<NormalizedHfColorGrading | null>(null);
  // Identity the pending edit was made FOR, snapshotted at schedule time —
  // read by a global flush instead of identityKeyRef.current, which may no
  // longer describe this edit's element by the time the flush runs.
  const pendingPersistIdentityRef = useRef<string | null>(null);
  // The last grading value actually confirmed saved — distinct from `grading`
  // (the optimistic value shown immediately on commit). A rejected persist
  // reverts to this instead of leaving the UI permanently showing a value
  // that was never written.
  const confirmedGradingRef = useRef(grading);
  // Monotonic per-commit version — guards against TWO edits on the SAME
  // element racing (not just a selection change). If edit A's persist is
  // still in flight when edit B commits, A's eventual settle must not stamp
  // confirmedGradingRef with its now-superseded value or revert `grading`
  // out from under B's newer optimistic state.
  const gradingVersionRef = useRef(0);
  const statusTimersRef = useRef<number[]>([]);
  const latestGradingRef = useRef(grading);
  const compareEnabledRef = useRef(compareEnabled);
  latestGradingRef.current = grading;
  compareEnabledRef.current = compareEnabled;

  // Reset all per-element STATE when the selection changes to a different
  // element — unlike the legacy ColorGradingSection (remounted via a
  // `key={selectionIdentityKey(element)}` from its parent), this hook is
  // called unconditionally on every render, so nothing naturally remounts it.
  // Without this, switching selection reuses the previous element's grading/
  // compare/mediaMetadata state. Adjusting state during render (comparing
  // against a ref) is React's documented pattern for STATE updates
  // specifically — it resolves in the same render pass instead of flashing
  // stale state for one frame, and is safe to repeat if React discards and
  // re-runs this render, since every value here is a pure function of
  // `element`. It must NOT be used for side effects or for consuming
  // shared mutable state (like the pending-persist timer/value) — a
  // discarded render would have already consumed them with no corresponding
  // effect ever running to compensate. That part happens below, in an
  // effect's cleanup, which is guaranteed to run only for a render that
  // actually committed.
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

  // Flushes — never discards — a still-pending edit when selection moves to
  // a different element, and cancels the debounce timer. Implemented as an
  // effect CLEANUP (not the render-phase block above, and not a queued ref
  // consumed by a separate effect): a cleanup only ever runs for the
  // specific effect instance that actually committed for `identityKey`, so
  // there's no window where a discarded/interrupted render could have
  // already consumed pendingPersistValueRef without this ever running to
  // compensate. The cleanup's closure captures onSetAttributeLive/target
  // bound to the OUTGOING identity, since it runs before the next effect
  // instance (for the NEW identity) is established.
  useEffect(() => {
    return () => {
      // Stale runtime-status timers scheduled for the OUTGOING element must
      // not fire after this: readRuntimeColorGradingStatus closes over
      // `target`, so an old timer firing post-switch would stamp the NEW
      // element's runtimeStatus with the OLD element's answer.
      for (const timer of statusTimersRef.current) clearTimeout(timer);
      statusTimersRef.current = [];
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      if (pendingPersistValueRef.current === undefined) return;
      const value = pendingPersistValueRef.current;
      pendingPersistValueRef.current = undefined;
      pendingPersistGradingRef.current = null;
      pendingPersistIdentityRef.current = null;
      trackStudioPendingEdit(onSetAttributeLive(COLOR_GRADING_DATA_KEY, value));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- identityKey is the intended trigger; see comment above
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
      .then(async (response) => {
        if (!response.ok) return { ok: false as const };
        const data: MediaMetadataResponse | null = await response.json();
        return { ok: true as const, metadata: data?.metadata ?? null };
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        // Only cache a definitive answer from a successful response — a non-OK
        // status is a transient/server failure, not a stable "no metadata"
        // result, and caching it would suppress the HDR banner for this asset
        // for the page's whole lifetime. Leave the key absent so the next
        // selection retries.
        if (!result.ok) {
          setMediaMetadata(null);
          return;
        }
        MEDIA_METADATA_CACHE.set(cacheKey, result.metadata);
        setMediaMetadata(result.metadata);
      })
      .catch(() => {
        // Same reasoning as the non-OK branch above: don't cache a network-
        // level fetch failure either.
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

  const persistColorGradingValue = useCallback(
    (
      value: string | null,
      attemptedGrading: NormalizedHfColorGrading,
      attemptIdentityKey: string,
      isLatestAttempt: () => boolean,
      setAttributeLive: (
        attr: string,
        value: string | null,
        onSettled?: (ok: boolean) => void,
      ) => void | Promise<void>,
    ) => {
      // Two guards, not one: identity (selection moved to a DIFFERENT
      // element — that element already got its own confirmedGradingRef
      // baseline from the reset block) and version (a NEWER edit landed on
      // the SAME element — e.g. the user dragged Exposure, then Contrast,
      // before Exposure's persist settled; Exposure settling afterward must
      // not stamp confirmedGradingRef with its now-superseded value or
      // revert `grading` out from under Contrast's newer optimistic state).
      const applySettled = (ok: boolean) => {
        if (identityKeyRef.current !== attemptIdentityKey) return;
        if (!isLatestAttempt()) return;
        if (ok) {
          confirmedGradingRef.current = attemptedGrading;
          return;
        }
        // Persist failed — the optimistic grading was never actually saved.
        // Revert to the last confirmed-good value instead of leaving the
        // control showing an unsaved state as if it succeeded.
        const reverted = confirmedGradingRef.current;
        latestGradingRef.current = reverted;
        setGrading(reverted);
        setRuntimeStatus({ state: "unavailable", message: "Save failed — reverted" });
      };
      // `onSettled` is the real signal — the underlying commit runner
      // (runDomEditCommit) intentionally swallows persist failures so a
      // caller `await`-ing this promise never sees a rejection; a rejection
      // handler here alone would be dead code against the actual Studio
      // callback. The `.catch` below is a fallback for any OTHER
      // implementation of onSetAttributeLive that rejects instead.
      // `setAttributeLive` is passed in by the caller rather than read from a
      // ref: a debounced persist for element A must call the callback that
      // was live when A's edit was SCHEDULED, not whatever the ref holds by
      // the time the timer fires — a "latest" ref would let a stale timer
      // wrongly target a since-selected element B's callback.
      const result = setAttributeLive(COLOR_GRADING_DATA_KEY, value ?? null, applySettled);
      return trackStudioPendingEdit(
        Promise.resolve(result).then(
          () => undefined,
          () => applySettled(false),
        ),
      );
    },
    [],
  );

  const flushPendingPersist = useCallback(() => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    if (pendingPersistValueRef.current === undefined) return undefined;
    const value = pendingPersistValueRef.current;
    const attemptedGrading = pendingPersistGradingRef.current ?? latestGradingRef.current;
    // Snapshotted at schedule time, not identityKeyRef.current read fresh
    // here — an async flush could otherwise tag the attempt with whatever
    // identity is "current" by then, not the one this edit was made for.
    const attemptIdentityKey = pendingPersistIdentityRef.current ?? identityKeyRef.current;
    pendingPersistValueRef.current = undefined;
    pendingPersistGradingRef.current = null;
    pendingPersistIdentityRef.current = null;
    // A flush cancels the pending debounce timer above, so this becomes the
    // one-and-only in-flight attempt for this element — bump the version so
    // it still registers as "the latest attempt" against the same guard a
    // regular debounced commit uses, instead of unconditionally claiming
    // that title. Without this, a newer edit landing after the flush starts
    // but before it settles would have its own eventual settle silently
    // lose the version race to this unconditionally-"latest" flush.
    const isLatestAttempt = bumpDomEditCommitVersion(gradingVersionRef);
    return persistColorGradingValue(
      value,
      attemptedGrading,
      attemptIdentityKey,
      isLatestAttempt,
      onSetAttributeLive,
    );
  }, [onSetAttributeLive, persistColorGradingValue]);

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
      pendingPersistGradingRef.current = nextGrading;
      pendingPersistIdentityRef.current = identityKeyRef.current;
      // Captured now (edit time), not read fresh inside the timer — the
      // timer fires 350ms later and may run after selection has already
      // moved on, at which point identityKeyRef.current would no longer
      // describe the element this edit was actually made for.
      const attemptIdentityKey = identityKeyRef.current;
      // Bumps a monotonic version and hands back a checker bound to THIS
      // specific commit — reused from the same primitive the DOM-attribute
      // commit runner uses for the identical same-target-rapid-edits race.
      const isLatestAttempt = bumpDomEditCommitVersion(gradingVersionRef);
      persistTimerRef.current = setTimeout(() => {
        const value = pendingPersistValueRef.current;
        const attemptedGrading = pendingPersistGradingRef.current ?? nextGrading;
        pendingPersistValueRef.current = undefined;
        pendingPersistGradingRef.current = null;
        pendingPersistIdentityRef.current = null;
        persistTimerRef.current = null;
        void persistColorGradingValue(
          value ?? null,
          attemptedGrading,
          attemptIdentityKey,
          isLatestAttempt,
          onSetAttributeLive,
        );
      }, 350);
    },
    [
      onSetAttributeLive,
      persistColorGradingValue,
      postColorGrading,
      postCompare,
      scheduleRuntimeStatusRefresh,
    ],
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
