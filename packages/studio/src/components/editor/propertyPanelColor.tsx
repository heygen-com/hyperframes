import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "../../icons/SystemIcons";
import {
  formatCssColor,
  hsvToRgb,
  parseCssColor,
  rgbToHsv,
  toHexColor,
  type ParsedColor,
} from "./colorValue";
import { resolveFloatingPanelPosition, type FloatingPosition } from "./floatingPanel";
import { colorFromCss, FIELD, LABEL } from "./propertyPanelHelpers";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useInspectorGestureTransaction } from "./useInspectorGestureTransaction";

const COLOR_PICKER_SIZE = { width: 292, height: 386 };

/* ------------------------------------------------------------------ */
/*  ColorSlider                                                        */
/* ------------------------------------------------------------------ */

function ColorSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  background,
  thumbColor,
  disabled,
  onPreview,
  onInteractionStart,
  onInteractionEnd,
  onInteractionCancel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  background: string;
  thumbColor: string;
  disabled?: boolean;
  onPreview: (nextValue: number) => void;
  onInteractionStart: () => void;
  onInteractionEnd: () => void;
  onInteractionCancel: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const percent = ((value - min) / (max - min)) * 100;

  const previewFromClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const rawValue = min + ((clientX - rect.left) / rect.width) * (max - min);
    const stepped = Math.round(rawValue / step) * step;
    onPreview(Math.max(min, Math.min(max, stepped)));
  };

  const previewKeyboardValue = (nextValue: number) => {
    onPreview(Math.max(min, Math.min(max, nextValue)));
  };

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <span className={LABEL}>{label}</span>
        <span className="text-[10px] font-medium text-neutral-400">{displayValue}</span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled}
        className={`relative h-4 rounded-full border border-neutral-700 shadow-[inset_0_1px_2px_rgba(0,0,0,0.55)] outline-none focus:border-panel-accent focus:ring-2 focus:ring-panel-accent/40 ${
          disabled ? "cursor-not-allowed opacity-50" : "cursor-ew-resize"
        }`}
        style={{ background }}
        onPointerDown={(event) => {
          if (disabled) return;
          onInteractionStart();
          event.currentTarget.setPointerCapture(event.pointerId);
          previewFromClientX(event.clientX);
        }}
        onPointerUp={(event) => {
          onInteractionEnd();
          event.currentTarget.blur();
        }}
        onPointerCancel={onInteractionCancel}
        onPointerMove={(event) => {
          if (disabled || event.buttons !== 1) return;
          previewFromClientX(event.clientX);
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onInteractionCancel();
            return;
          }
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            onInteractionStart();
            previewKeyboardValue(value + step);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            onInteractionStart();
            previewKeyboardValue(value - step);
          } else if (event.key === "Home") {
            event.preventDefault();
            onInteractionStart();
            previewKeyboardValue(min);
          } else if (event.key === "End") {
            event.preventDefault();
            onInteractionStart();
            previewKeyboardValue(max);
          }
        }}
        onKeyUp={(event) => {
          if (
            ["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "Home", "End"].includes(event.key)
          ) {
            onInteractionEnd();
          }
        }}
        onBlur={onInteractionEnd}
      >
        <div
          className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.85),0_6px_14px_rgba(0,0,0,0.5)]"
          style={{ left: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: thumbColor }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ColorField                                                         */
/* ------------------------------------------------------------------ */

export function ColorField({
  label,
  value,
  disabled,
  onReset,
  flat,
  mixed,
  onPreview,
  onCommit,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onReset?: () => void;
  flat?: boolean;
  mixed?: boolean;
  onPreview?: (nextValue: string) => void;
  onCommit: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<FloatingPosition | null>(null);
  const [draftColor, setDraftColor] = useState<ParsedColor>(() => colorFromCss(value));
  const draftColorRef = useRef(draftColor);
  draftColorRef.current = draftColor;
  const [hexDraft, setHexDraft] = useState(() => toHexColor(colorFromCss(value)).toUpperCase());
  const hsv = rgbToHsv(draftColor);
  const hueColor = formatCssColor({
    ...hsvToRgb({ hue: hsv.hue, saturation: 1, value: 1 }),
    alpha: 1,
  });
  const opaqueColor = formatCssColor({ ...draftColor, alpha: 1 });
  const currentColor = formatCssColor(draftColor);
  const saturationPercent = Math.round(hsv.saturation * 100);
  const brightnessPercent = Math.round(hsv.value * 100);
  const alphaPercent = Math.round(draftColor.alpha * 100);

  const updateColorDraft = useCallback((nextValue: string) => {
    const nextColor = parseCssColor(nextValue);
    if (!nextColor) return;
    setDraftColor(nextColor);
    setHexDraft(toHexColor(nextColor).toUpperCase());
  }, []);
  const persistColorValue = useCallback(
    (nextValue: string) => {
      if (nextValue !== value) track("color", label);
      onCommit(nextValue);
    },
    [label, onCommit, track, value],
  );
  const {
    begin: beginColorGesture,
    preview: previewColorGesture,
    settle: settleColorGesture,
    cancel: cancelColorGesture,
  } = useInspectorGestureTransaction({
    sourceValue: value,
    onPreview: (nextValue) => {
      updateColorDraft(nextValue);
      onPreview?.(nextValue);
    },
    onCommit: persistColorValue,
  });

  useEffect(() => {
    const nextColor = colorFromCss(value);
    setDraftColor(nextColor);
    setHexDraft(toHexColor(nextColor).toUpperCase());
  }, [value]);

  const updatePanelPosition = useCallback(() => {
    const anchor = buttonRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const measured = panelRef.current?.getBoundingClientRect();
    setPanelPosition(
      resolveFloatingPanelPosition(
        anchor,
        { width: window.innerWidth, height: window.innerHeight },
        {
          width: measured?.width || COLOR_PICKER_SIZE.width,
          height: measured?.height || COLOR_PICKER_SIZE.height,
        },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
    const handlePositionInvalidated = () => updatePanelPosition();
    window.addEventListener("resize", handlePositionInvalidated);
    window.addEventListener("scroll", handlePositionInvalidated, true);
    return () => {
      window.removeEventListener("resize", handlePositionInvalidated);
      window.removeEventListener("scroll", handlePositionInvalidated, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      settleColorGesture();
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelColorGesture();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelColorGesture, open, settleColorGesture]);

  const previewColor = (nextColor: ParsedColor) => {
    previewColorGesture(formatCssColor(nextColor));
  };

  const commitHsv = (nextHsv: { hue?: number; saturation?: number; value?: number }) => {
    const rgb = hsvToRgb({
      hue: nextHsv.hue ?? hsv.hue,
      saturation: nextHsv.saturation ?? hsv.saturation,
      value: nextHsv.value ?? hsv.value,
    });
    previewColor({ ...rgb, alpha: draftColorRef.current.alpha });
  };

  const updateSaturationValue = (clientX: number, clientY: number, target: HTMLDivElement) => {
    const rect = target.getBoundingClientRect();
    const saturation = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextValue = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
    commitHsv({ saturation, value: nextValue });
  };

  const handleHexCommit = (nextHex: string) => {
    setHexDraft(nextHex);
    const normalized = nextHex.trim().startsWith("#") ? nextHex.trim() : `#${nextHex.trim()}`;
    const parsed = parseCssColor(normalized);
    if (!parsed) return;
    const nextValue = formatCssColor({ ...parsed, alpha: draftColorRef.current.alpha });
    updateColorDraft(nextValue);
  };

  const picker = open
    ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] w-[292px] overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/50"
          style={{
            left: panelPosition?.left ?? -9999,
            top: panelPosition?.top ?? -9999,
          }}
        >
          <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-neutral-100">{label}</div>
              <div className="text-[9px] uppercase tracking-[0.16em] text-neutral-600">Color</div>
            </div>
            <button
              type="button"
              onClick={() => {
                settleColorGesture();
                setOpen(false);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-200"
              aria-label="Close color picker"
            >
              <X size={13} />
            </button>
          </div>
          <div className="space-y-3 p-3">
            <div
              className="relative h-36 cursor-crosshair overflow-hidden rounded-xl border border-neutral-700 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
              style={{ backgroundColor: hueColor }}
              onPointerDown={(event) => {
                beginColorGesture();
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSaturationValue(event.clientX, event.clientY, event.currentTarget);
              }}
              onPointerMove={(event) => {
                if (event.buttons !== 1) return;
                updateSaturationValue(event.clientX, event.clientY, event.currentTarget);
              }}
              onPointerUp={settleColorGesture}
              onPointerCancel={cancelColorGesture}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
              <div
                className="pointer-events-none absolute top-0 h-full w-px -translate-x-1/2 bg-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] mix-blend-difference"
                style={{ left: `${hsv.saturation * 100}%` }}
              />
              <div
                className="pointer-events-none absolute left-0 h-px w-full -translate-y-1/2 bg-white/70 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] mix-blend-difference"
                style={{ top: `${(1 - hsv.value) * 100}%` }}
              />
              <div
                className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.85),0_8px_18px_rgba(0,0,0,0.45)]"
                style={{
                  left: `${hsv.saturation * 100}%`,
                  top: `${(1 - hsv.value) * 100}%`,
                  backgroundColor: opaqueColor,
                }}
              />
            </div>

            <div className="flex min-w-0 items-center gap-3">
              <div
                className="h-9 w-9 flex-shrink-0 rounded-xl border border-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                style={{ backgroundColor: currentColor }}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-neutral-100">
                  {currentColor}
                </div>
                <div className="mt-0.5 text-[9px] text-neutral-600">
                  S {saturationPercent}% · B {brightnessPercent}% · A {alphaPercent}%
                </div>
              </div>
            </div>

            <ColorSlider
              label="Hue"
              value={hsv.hue}
              min={0}
              max={360}
              step={1}
              displayValue={`${Math.round(hsv.hue)}°`}
              background="linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
              thumbColor={hueColor}
              disabled={disabled}
              onInteractionStart={beginColorGesture}
              onPreview={(nextHue) => commitHsv({ hue: nextHue })}
              onInteractionEnd={settleColorGesture}
              onInteractionCancel={cancelColorGesture}
            />

            <ColorSlider
              label="Alpha"
              value={draftColor.alpha}
              min={0}
              max={1}
              step={0.01}
              displayValue={`${alphaPercent}%`}
              background={`linear-gradient(90deg, transparent, ${opaqueColor})`}
              thumbColor={currentColor}
              disabled={disabled}
              onInteractionStart={beginColorGesture}
              onPreview={(nextAlpha) =>
                previewColor({ ...draftColorRef.current, alpha: nextAlpha })
              }
              onInteractionEnd={settleColorGesture}
              onInteractionCancel={cancelColorGesture}
            />

            <label className="grid gap-1.5">
              <span className={LABEL}>Hex</span>
              <input
                value={hexDraft}
                onChange={(event) => handleHexCommit(event.target.value)}
                onBlur={() => {
                  const normalized = hexDraft.trim().startsWith("#")
                    ? hexDraft.trim()
                    : `#${hexDraft.trim()}`;
                  const parsed = parseCssColor(normalized);
                  if (parsed) {
                    const nextValue = formatCssColor({
                      ...parsed,
                      alpha: draftColorRef.current.alpha,
                    });
                    persistColorValue(nextValue);
                  }
                  setHexDraft(toHexColor(draftColorRef.current).toUpperCase());
                }}
                className={`${FIELD} h-10 w-full text-[11px] font-medium outline-none`}
                spellCheck={false}
              />
            </label>
          </div>
        </div>,
        document.body,
      )
    : null;

  const openPicker = () => {
    if (disabled) return;
    if (open) settleColorGesture();
    setOpen((current) => !current);
    if (!open) {
      requestAnimationFrame(updatePanelPosition);
    }
  };

  if (flat) {
    return (
      <div className="flex min-h-[30px] items-center justify-between">
        <span className="text-[11px] text-panel-text-2">{label}</span>
        <button
          type="button"
          data-flat-color-trigger="true"
          disabled={disabled}
          aria-label={`Pick ${label.toLowerCase()} color`}
          ref={buttonRef}
          onClick={openPicker}
          className="flex items-center gap-2 disabled:cursor-not-allowed"
        >
          <span
            className="h-4 w-4 flex-shrink-0 rounded-[4px]"
            style={{ backgroundColor: open ? currentColor : value || "transparent" }}
          />
          <span className="font-mono text-[11px] text-panel-text-0">
            {open ? currentColor : value}
          </span>
          {mixed && (
            <span
              data-color-mixed-indicator="true"
              className="rounded bg-panel-hover px-1.5 py-0.5 text-[9px] font-medium text-panel-text-4"
            >
              Mixed
            </span>
          )}
        </button>
        {picker}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className={LABEL}>{label}</span>
        {onReset && (
          <button
            type="button"
            disabled={disabled}
            onClick={onReset}
            className="rounded bg-panel-hover px-1.5 py-0.5 text-[9px] font-medium text-panel-text-4 transition-colors hover:text-panel-text-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset
          </button>
        )}
      </div>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Pick ${label.toLowerCase()} color`}
        ref={buttonRef}
        onClick={openPicker}
        className={`${FIELD} flex items-center gap-3 text-left hover:border-neutral-700 disabled:cursor-not-allowed ${open ? "border-neutral-600" : ""}`}
      >
        <div
          className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          style={{ backgroundColor: value || "transparent" }}
        />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-neutral-100">
          {value}
        </span>
        {mixed && (
          <span
            data-color-mixed-indicator="true"
            className="rounded bg-panel-hover px-1.5 py-0.5 text-[9px] font-medium text-panel-text-4"
          >
            Mixed
          </span>
        )}
      </button>
      {picker}
    </div>
  );
}
