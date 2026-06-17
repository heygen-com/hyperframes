import { memo, useCallback, useMemo, useState } from "react";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import { SUPPORTED_EASES, SUPPORTED_PROPS } from "@hyperframes/core/gsap-constants";
import { RESPONSIVE_GRID } from "./propertyPanelHelpers";
import { MetricField, SelectField } from "./propertyPanelPrimitives";
import { controlPointsForGsapEase } from "./studioMotion";
import {
  EASE_LABELS,
  METHOD_LABELS,
  METHOD_TOOLTIPS,
  PERCENT_PROPS,
  PROP_CONSTRAINTS,
  PROP_LABELS,
  PROP_TOOLTIPS,
  PROP_UNITS,
  clampPropertyValue,
} from "./gsapAnimationConstants";
import { buildTweenSummary } from "./gsapAnimationHelpers";
import { EaseCurveSection } from "./EaseCurveSection";
import { ArcPathControls } from "./ArcPathControls";
import type { GsapAnimationEditCallbacks } from "./gsapAnimationCallbacks";
import { ComputedTweenNotice } from "./ComputedTweenNotice";
import { P } from "./panelTokens";
const BOOLEAN_PROPS = new Set(["visibility"]);
const STRING_PROPS = new Set(["filter", "clipPath"]);

const FILTER_PRESETS = [
  { label: "Blur", value: "blur(4px)" },
  { label: "Bright", value: "brightness(1.5)" },
  { label: "Gray", value: "grayscale(1)" },
  { label: "None", value: "none" },
];

const CLIP_PATH_PRESETS = [
  { label: "Circle", value: "circle(50% at 50% 50%)" },
  { label: "Inset", value: "inset(10%)" },
  { label: "None", value: "none" },
];

function isPercentProp(prop: string): boolean {
  return PERCENT_PROPS.has(prop);
}

function displayValue(prop: string, val: number | string): string {
  if (isPercentProp(prop)) return String(Math.round(Math.max(0, Math.min(1, Number(val))) * 100));
  return String(val);
}

function adjustedValue(prop: string, raw: string): string {
  if (isPercentProp(prop)) return String(clampPropertyValue(prop, Number(raw) / 100));
  const num = Number(raw);
  if (!Number.isNaN(num) && PROP_CONSTRAINTS[prop]) {
    return String(clampPropertyValue(prop, num));
  }
  return raw;
}

function RemoveButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 rounded p-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-red-400"
      title={title}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3 3l6 6M9 3l-6 6" />
      </svg>
    </button>
  );
}

function PropertyRow({
  prop,
  val,
  onCommit,
  onRemove,
  removeTitle,
}: {
  prop: string;
  val: number | string;
  onCommit: (adjusted: string) => void;
  onRemove: () => void;
  removeTitle: string;
}) {
  if (BOOLEAN_PROPS.has(prop)) {
    const isVisible = val === "visible" || val === 1;
    return (
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800">
          <span className="flex-1 text-[11px] font-medium text-neutral-500">
            {PROP_LABELS[prop] ?? prop}
          </span>
          <button
            type="button"
            onClick={() => onCommit(isVisible ? "hidden" : "visible")}
            className={`flex-shrink-0 rounded-full transition-all duration-150 relative`}
            style={{ width: 28, height: 16, background: isVisible ? P.accent : P.borderInput }}
            title={isVisible ? "Visible — click to hide" : "Hidden — click to show"}
          >
            <span
              className="absolute top-[2px] left-0 rounded-full transition-transform duration-150"
              style={{
                width: 12,
                height: 12,
                background: isVisible ? P.white : P.textMuted,
                transform: isVisible ? "translateX(14px)" : "translateX(2px)",
              }}
            />
          </button>
        </div>
        <RemoveButton onClick={onRemove} title={removeTitle} />
      </div>
    );
  }

  if (STRING_PROPS.has(prop)) {
    const presets =
      prop === "filter" ? FILTER_PRESETS : prop === "clipPath" ? CLIP_PATH_PRESETS : [];
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 flex items-center gap-2 px-2 py-1 rounded-lg bg-neutral-900 border border-neutral-800">
            <span className="flex-shrink-0 text-[11px] font-medium text-neutral-500">
              {PROP_LABELS[prop] ?? prop}
            </span>
            <input
              type="text"
              defaultValue={String(val)}
              className="flex-1 bg-transparent text-[11px] text-neutral-200 outline-none"
              onBlur={(e) => onCommit(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
          <RemoveButton onClick={onRemove} title={removeTitle} />
        </div>
        {presets.length > 0 && (
          <div className="flex gap-1 pl-1">
            {presets.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onCommit(p.value)}
                className="px-1.5 py-0.5 rounded text-[9px] font-medium text-neutral-500 bg-neutral-800/50 hover:bg-neutral-800 hover:text-neutral-300 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <div className="min-w-0 flex-1">
        <MetricField
          label={PROP_LABELS[prop] ?? prop}
          value={displayValue(prop, val)}
          suffix={PROP_UNITS[prop]}
          tooltip={PROP_TOOLTIPS[prop]}
          scrub
          liveCommit
          onCommit={(raw) => onCommit(adjustedValue(prop, raw))}
        />
      </div>
      <RemoveButton onClick={onRemove} title={removeTitle} />
    </div>
  );
}

function AddPropertyTrigger({
  adding,
  available,
  addLabel,
  addTitle,
  onAdd,
  onOpen,
  onClose,
  buttonClassName,
}: {
  adding: boolean;
  available: string[];
  addLabel: string;
  addTitle: string;
  onAdd: (prop: string) => void;
  onOpen: () => void;
  onClose: () => void;
  buttonClassName: string;
}) {
  if (adding && available.length > 0) {
    return (
      <select
        autoFocus
        className="min-w-0 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100 outline-none"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onAdd(e.target.value);
          onClose();
        }}
        onBlur={onClose}
      >
        <option value="" disabled>
          Choose property…
        </option>
        {available.map((p) => (
          <option key={p} value={p}>
            {PROP_LABELS[p] ?? p}
          </option>
        ))}
      </select>
    );
  }
  if (available.length === 0) return null;
  return (
    <button type="button" onClick={onOpen} className={buttonClassName} title={addTitle}>
      {addLabel}
    </button>
  );
}

function parseNumericOrString(raw: string): number | string {
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

interface AnimationCardProps extends GsapAnimationEditCallbacks {
  animation: GsapAnimation;
  defaultExpanded: boolean;
}

// fallow-ignore-next-line complexity
export const AnimationCard = memo(function AnimationCard({
  animation,
  defaultExpanded,
  onUpdateProperty,
  onUpdateMeta,
  onDeleteAnimation,
  onAddProperty,
  onRemoveProperty,
  onUpdateFromProperty,
  onAddFromProperty,
  onRemoveFromProperty,
  onLivePreview,
  onLivePreviewEnd,
  onSetArcPath,
  onUpdateArcSegment,
  onUnroll,
}: AnimationCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [addingProp, setAddingProp] = useState(false);
  const [addingFromProp, setAddingFromProp] = useState(false);

  const usedProps = useMemo(
    () => new Set(Object.keys(animation.properties)),
    [animation.properties],
  );
  const availableProps = useMemo(
    () =>
      SUPPORTED_PROPS.filter(
        (p) => !usedProps.has(p) && (animation.method === "set" || !BOOLEAN_PROPS.has(p)),
      ),
    [usedProps, animation.method],
  );

  const usedFromProps = useMemo(
    () => new Set(Object.keys(animation.fromProperties ?? {})),
    [animation.fromProperties],
  );
  const availableFromProps = useMemo(
    () => SUPPORTED_PROPS.filter((p) => !usedFromProps.has(p) && !BOOLEAN_PROPS.has(p)),
    [usedFromProps],
  );

  const commitProperty = useCallback(
    (prop: string, raw: string) => {
      const value = parseNumericOrString(raw);
      onUpdateProperty(animation.id, prop, value);
      onLivePreviewEnd?.();
    },
    [animation.id, onUpdateProperty, onLivePreviewEnd],
  );

  const scrubProperty = useCallback(
    (prop: string, raw: string) => {
      onLivePreview?.(prop, parseNumericOrString(raw));
    },
    [onLivePreview],
  );

  const commitFromProperty = useCallback(
    (prop: string, raw: string) => {
      const value = parseNumericOrString(raw);
      onUpdateFromProperty?.(animation.id, prop, value);
      onLivePreviewEnd?.();
    },
    [animation.id, onUpdateFromProperty, onLivePreviewEnd],
  );

  const commitDuration = useCallback(
    (raw: string) => {
      const num = Number(raw);
      if (Number.isFinite(num) && num >= 0)
        onUpdateMeta(animation.id, { duration: Math.max(0, num) });
    },
    [animation.id, onUpdateMeta],
  );

  const commitPosition = useCallback(
    (raw: string) => {
      const num = Number(raw);
      if (Number.isFinite(num) && num >= 0)
        onUpdateMeta(animation.id, { position: Math.max(0, num) });
    },
    [animation.id, onUpdateMeta],
  );

  const [copied, setCopied] = useState(false);

  const methodLabel = METHOD_LABELS[animation.method] ?? animation.method;
  const easeName = animation.ease ?? animation.keyframes?.easeEach ?? "none";
  const easeLabel = easeName.startsWith("custom(")
    ? "Custom curve"
    : (EASE_LABELS[easeName] ?? easeName);
  const endTime =
    typeof animation.position === "number"
      ? animation.position + (animation.duration ?? 0)
      : animation.position;

  const summary = useMemo(() => buildTweenSummary(animation), [animation]);

  return (
    <div className="border-b border-neutral-800 pb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 py-1.5"
      >
        <span
          className="rounded bg-panel-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-panel-accent"
          title={METHOD_TOOLTIPS[animation.method]}
        >
          {methodLabel}
        </span>
        <span className="text-[11px] font-medium text-neutral-400" title="When this effect plays">
          {typeof animation.position === "number"
            ? `${parseFloat(animation.position.toFixed(3))}s`
            : animation.position}{" "}
          – {typeof endTime === "number" ? `${parseFloat(endTime.toFixed(3))}s` : endTime}
        </span>
        <span className="ml-auto text-[10px] text-neutral-500" title={easeName}>
          {easeLabel}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={`flex-shrink-0 text-neutral-500 transition-transform ${expanded ? "" : "-rotate-90"}`}
        >
          <path d="M2 3l3 4 3-4z" />
        </svg>
      </button>

      {expanded && (
        <div className="pt-2">
          <div className="space-y-3">
            <ComputedTweenNotice
              provenance={animation.provenance}
              onUnroll={onUnroll ? () => onUnroll(animation.id) : undefined}
            />
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <p className="text-[10px] leading-relaxed text-neutral-400 italic">{summary}</p>
                {animation.keyframes && (
                  <p className="mt-1 text-[9px] text-neutral-500">
                    <span
                      className="inline-block w-2 h-2 mr-1 align-middle"
                      style={{
                        background: "currentColor",
                        clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
                      }}
                    />
                    Keyframed — edit values in the Layout panel above
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(summary);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex-shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
                title="Copy description to clipboard — paste into agent prompts"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className={RESPONSIVE_GRID}>
              {animation.method !== "set" && (
                <MetricField
                  label="Length"
                  value={String(Math.max(0, animation.duration ?? 0))}
                  suffix="s"
                  tooltip="How long this effect lasts"
                  onCommit={commitDuration}
                />
              )}
              <MetricField
                label="Starts at"
                value={
                  typeof animation.position === "string"
                    ? animation.position
                    : String(parseFloat(Math.max(0, animation.position).toFixed(3)))
                }
                suffix={typeof animation.position === "number" ? "s" : undefined}
                tooltip="When this effect begins on the timeline"
                onCommit={commitPosition}
              />
            </div>

            {animation.method !== "set" && (
              <>
                <SelectField
                  label="Speed"
                  value={easeName.startsWith("custom(") ? "custom" : easeName}
                  options={[...SUPPORTED_EASES, "custom"]}
                  onChange={(next) => {
                    if (next === "custom") {
                      const points = controlPointsForGsapEase(
                        easeName !== "none" ? easeName : "power2.out",
                      );
                      const path = `M0,0 C${points.x1},${points.y1} ${points.x2},${points.y2} 1,1`;
                      onUpdateMeta(animation.id, { ease: `custom(${path})` });
                    } else {
                      onUpdateMeta(animation.id, { ease: next });
                    }
                  }}
                />
                <EaseCurveSection
                  ease={easeName}
                  duration={animation.duration}
                  onCustomEaseCommit={(customEase) =>
                    onUpdateMeta(animation.id, { ease: customEase })
                  }
                />
              </>
            )}

            {animation.method === "fromTo" && (
              <div className="space-y-1">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-orange-400/70">
                  From
                </p>
                <div className="space-y-1.5">
                  {Object.entries(animation.fromProperties ?? {}).map(([prop, val]) => (
                    <PropertyRow
                      key={prop}
                      prop={prop}
                      val={val}
                      onCommit={(adjusted) => commitFromProperty(prop, adjusted)}
                      onRemove={() => onRemoveFromProperty?.(animation.id, prop)}
                      removeTitle={`Remove from-${PROP_LABELS[prop] ?? prop}`}
                    />
                  ))}
                </div>
                <div className="pt-0.5">
                  <AddPropertyTrigger
                    adding={addingFromProp}
                    available={availableFromProps}
                    addLabel="+ From property"
                    addTitle="Add a from-state property"
                    onAdd={(prop) => onAddFromProperty?.(animation.id, prop)}
                    onOpen={() => setAddingFromProp(true)}
                    onClose={() => setAddingFromProp(false)}
                    buttonClassName="text-[11px] font-medium text-orange-400/70 transition-colors hover:text-orange-300"
                  />
                </div>
              </div>
            )}

            {animation.method === "fromTo" && Object.keys(animation.properties).length > 0 && (
              <p className="text-[9px] font-semibold uppercase tracking-wider text-panel-accent/70">
                To
              </p>
            )}

            {Object.keys(animation.properties).length > 0 && (
              <div className="space-y-1.5">
                {Object.entries(animation.properties).map(([prop, val]) => (
                  <PropertyRow
                    key={prop}
                    prop={prop}
                    val={val}
                    onCommit={(adjusted) => {
                      scrubProperty(prop, adjusted);
                      commitProperty(prop, adjusted);
                    }}
                    onRemove={() => onRemoveProperty(animation.id, prop)}
                    removeTitle={`Remove ${PROP_LABELS[prop] ?? prop}`}
                  />
                ))}
              </div>
            )}

            {onSetArcPath &&
              (animation.properties.x != null ||
                animation.properties.y != null ||
                animation.keyframes) && (
                <div className="border-t border-neutral-800 pt-3">
                  <ArcPathControls
                    arcPath={
                      animation.arcPath ?? { enabled: false, autoRotate: false, segments: [] }
                    }
                    segmentCount={Math.max(
                      animation.properties.x != null || animation.properties.y != null ? 1 : 0,
                      (animation.keyframes?.keyframes?.length ?? 0) - 1,
                    )}
                    onToggle={(enabled) =>
                      onSetArcPath(animation.id, {
                        enabled,
                        segments: animation.arcPath?.segments,
                      })
                    }
                    onUpdateSegment={(index, update) =>
                      onUpdateArcSegment?.(animation.id, index, update)
                    }
                    onToggleAutoRotate={(autoRotate) =>
                      onSetArcPath(animation.id, {
                        enabled: true,
                        autoRotate,
                        segments: animation.arcPath?.segments,
                      })
                    }
                  />
                </div>
              )}

            <div className="flex items-center gap-2 pt-1">
              <AddPropertyTrigger
                adding={addingProp}
                available={availableProps}
                addLabel="+ Effect"
                addTitle="Add another animated property to this effect"
                onAdd={(prop) => onAddProperty(animation.id, prop)}
                onOpen={() => setAddingProp(true)}
                onClose={() => setAddingProp(false)}
                buttonClassName="text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-200"
              />
              <button
                type="button"
                onClick={() => onDeleteAnimation(animation.id)}
                className="ml-auto text-[11px] font-medium text-red-400 transition-colors hover:text-red-300"
                title="Remove this animation"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
