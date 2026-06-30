import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  HF_COLOR_GRADING_ATTR,
  HF_COLOR_GRADING_COLOR_SPACE,
  isHfColorGradingActive,
  normalizeHfColorGrading,
  serializeHfColorGrading,
  type HfColorGradingAdjustKey,
  type HfColorGradingTarget,
  type NormalizedHfColorGrading,
} from "@hyperframes/core/color-grading";
import { Compare, Palette, RotateCcw } from "../../icons/SystemIcons";
import type { DomEditSelection } from "./domEditing";
import { ColorGradingControls } from "./propertyPanelColorGradingControls";
import { Section } from "./propertyPanelPrimitives";

const DEFAULT_ADJUST: Record<HfColorGradingAdjustKey, number> = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
};

const DEFAULT_COLOR_GRADING: NormalizedHfColorGrading = {
  enabled: true,
  preset: "neutral",
  intensity: 1,
  adjust: DEFAULT_ADJUST,
  lut: null,
  colorSpace: HF_COLOR_GRADING_COLOR_SPACE,
};

const COLOR_GRADING_DATA_KEY = HF_COLOR_GRADING_ATTR.replace(/^data-/, "");

interface RuntimeColorGradingStatus {
  state: "missing" | "inactive" | "pending" | "active" | "unavailable";
  message: string;
}

function readColorGradingFromElement(element: DomEditSelection): NormalizedHfColorGrading {
  const grading =
    normalizeHfColorGrading(element.dataAttributes[COLOR_GRADING_DATA_KEY]) ??
    DEFAULT_COLOR_GRADING;
  return { ...grading, intensity: 1 };
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

function StatusPill({ status }: { status: RuntimeColorGradingStatus }) {
  const dotClass =
    status.state === "active"
      ? "bg-emerald-400"
      : status.state === "pending"
        ? "bg-amber-300"
        : status.state === "unavailable"
          ? "bg-red-400"
          : "bg-panel-text-5";
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded bg-panel-input px-2 py-1 text-[10px] font-medium text-panel-text-3">
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass}`} />
      <span className="truncate">{status.message}</span>
    </div>
  );
}

function HoldBeforeButton({
  active,
  disabled,
  onHoldChange,
}: {
  active: boolean;
  disabled: boolean;
  onHoldChange: (holding: boolean) => void;
}) {
  const startHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onHoldChange(true);
    const release = () => {
      onHoldChange(false);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
  };
  const stopHold = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onHoldChange(false);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={active}
      aria-label="Hold to show original"
      onPointerDown={startHold}
      onPointerUp={stopHold}
      onPointerCancel={stopHold}
      onBlur={() => {
        if (active) onHoldChange(false);
      }}
      onKeyDown={(event) => {
        if (disabled || (event.key !== " " && event.key !== "Enter")) return;
        event.preventDefault();
        if (!active) onHoldChange(true);
      }}
      onKeyUp={(event) => {
        if (disabled || (event.key !== " " && event.key !== "Enter")) return;
        event.preventDefault();
        onHoldChange(false);
      }}
      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded transition-colors ${
        active
          ? "bg-studio-accent text-black"
          : "text-panel-text-4 hover:bg-panel-hover hover:text-panel-text-1"
      } disabled:cursor-not-allowed disabled:opacity-40`}
      title="Hold to show original"
    >
      <Compare size={13} />
    </button>
  );
}

export function ColorGradingSection({
  element,
  assets,
  previewIframeRef,
  onImportAssets,
  onSetAttributeLive,
}: {
  element: DomEditSelection;
  assets: string[];
  previewIframeRef?: RefObject<HTMLIFrameElement | null>;
  onImportAssets?: (files: FileList, dir?: string) => Promise<string[]>;
  onSetAttributeLive: (attr: string, value: string | null) => void | Promise<void>;
}) {
  const [grading, setGrading] = useState(() => readColorGradingFromElement(element));
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeColorGradingStatus>(() => ({
    state: "pending",
    message: "Waiting for runtime",
  }));
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPersistValueRef = useRef<string | null | undefined>(undefined);
  const onSetAttributeLiveRef = useRef(onSetAttributeLive);
  const compareEnabledRef = useRef(compareEnabled);
  onSetAttributeLiveRef.current = onSetAttributeLive;
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
    refreshRuntimeStatus();
  }, [refreshRuntimeStatus]);

  useEffect(() => {
    const iframe = previewIframeRef?.current;
    if (!iframe) return;
    const refresh = () => {
      window.setTimeout(refreshRuntimeStatus, 50);
    };
    iframe.addEventListener("load", refresh);
    const timer = window.setTimeout(refreshRuntimeStatus, 80);
    return () => {
      iframe.removeEventListener("load", refresh);
      window.clearTimeout(timer);
    };
  }, [previewIframeRef, refreshRuntimeStatus]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      if (pendingPersistValueRef.current !== undefined) {
        void onSetAttributeLiveRef.current(COLOR_GRADING_DATA_KEY, pendingPersistValueRef.current);
        pendingPersistValueRef.current = undefined;
      }
    };
  }, []);

  const postColorGrading = useCallback(
    (nextGrading: NormalizedHfColorGrading) => {
      previewIframeRef?.current?.contentWindow?.postMessage(
        {
          source: "hf-parent",
          type: "control",
          action: "set-color-grading",
          target,
          grading: toBridgeColorGrading(nextGrading),
        },
        "*",
      );
    },
    [previewIframeRef, target],
  );

  const postCompare = useCallback(
    (enabled: boolean) => {
      previewIframeRef?.current?.contentWindow?.postMessage(
        {
          source: "hf-parent",
          type: "control",
          action: "set-color-grading-compare",
          target,
          compare: {
            enabled,
            position: 1,
            lineWidth: 0,
          },
        },
        "*",
      );
    },
    [previewIframeRef, target],
  );

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
      window.setTimeout(refreshRuntimeStatus, 50);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
      pendingPersistValueRef.current = isHfColorGradingActive(nextGrading)
        ? serializeHfColorGrading(nextGrading)
        : null;
      persistTimerRef.current = setTimeout(() => {
        const value = pendingPersistValueRef.current;
        pendingPersistValueRef.current = undefined;
        void onSetAttributeLive(COLOR_GRADING_DATA_KEY, value ?? null);
      }, 350);
    },
    [onSetAttributeLive, postColorGrading, postCompare, refreshRuntimeStatus],
  );

  const commitCompare = useCallback(
    (enabled: boolean) => {
      const nextEnabled = enabled && isHfColorGradingActive(grading);
      setCompareEnabled(nextEnabled);
      if (nextEnabled) postColorGrading(grading);
      postCompare(nextEnabled);
      window.setTimeout(refreshRuntimeStatus, 50);
    },
    [grading, postColorGrading, postCompare, refreshRuntimeStatus],
  );

  return (
    <Section
      title="Color Grading"
      icon={<Palette size={15} />}
      accessory={
        <div className="flex min-w-0 items-center gap-1.5">
          <HoldBeforeButton
            active={compareEnabled}
            disabled={!isHfColorGradingActive(grading)}
            onHoldChange={commitCompare}
          />
          <StatusPill status={runtimeStatus} />
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              commitColorGrading(DEFAULT_COLOR_GRADING);
            }}
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-panel-text-4 transition-colors hover:bg-panel-hover hover:text-panel-text-1"
            title="Reset grading"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      }
    >
      <ColorGradingControls
        grading={grading}
        assets={assets}
        onImportAssets={onImportAssets}
        onCommitColorGrading={commitColorGrading}
      />
    </Section>
  );
}
