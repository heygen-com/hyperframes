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
  PROP_LABELS,
  PROP_TOOLTIPS,
  PROP_UNITS,
} from "./gsapAnimationConstants";
import { EaseCurveSection } from "./EaseCurveSection";

const PERCENT_PROPS = new Set(["opacity", "autoAlpha"]);
function isPercentProp(prop: string): boolean {
  return PERCENT_PROPS.has(prop);
}

function buildTweenSummary(animation: GsapAnimation): string {
  const easeName = animation.ease ?? "none";
  const ease = EASE_LABELS[easeName] ?? easeName;
  const props = Object.entries(animation.properties);
  const target = animation.targetSelector;
  const dur = animation.duration ?? 0;
  const pos = animation.position;
  const propDescs = props.map(([p, v]) => {
    const label = (PROP_LABELS[p] ?? p).toLowerCase();
    const unit = PROP_UNITS[p] ?? "";
    return `${label} to ${v}${unit}`;
  });
  const propText = propDescs.length > 0 ? propDescs.join(", ") : "no properties yet";
  if (animation.method === "set") return `At ${pos}s, instantly set ${target}'s ${propText}.`;
  if (animation.method === "from")
    return `Starting at ${pos}s, over ${dur}s, ${target} enters from ${propText} using a ${ease.toLowerCase()} curve.`;
  return `Starting at ${pos}s, over ${dur}s, animate ${target}'s ${propText} using a ${ease.toLowerCase()} curve.`;
}

function parseNumericOrString(raw: string): number | string {
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

interface AnimationCardProps {
  animation: GsapAnimation;
  defaultExpanded: boolean;
  onUpdateProperty: (animationId: string, property: string, value: number | string) => void;
  onUpdateMeta: (
    animationId: string,
    updates: { duration?: number; ease?: string; position?: number },
  ) => void;
  onDeleteAnimation: (animationId: string) => void;
  onAddProperty: (animationId: string, property: string) => void;
  onRemoveProperty: (animationId: string, property: string) => void;
  onLivePreview?: (property: string, value: number | string) => void;
  onLivePreviewEnd?: () => void;
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
  onLivePreview,
  onLivePreviewEnd,
}: AnimationCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [addingProp, setAddingProp] = useState(false);

  const usedProps = useMemo(
    () => new Set(Object.keys(animation.properties)),
    [animation.properties],
  );
  const availableProps = useMemo(
    () => SUPPORTED_PROPS.filter((p) => !usedProps.has(p)),
    [usedProps],
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
  const easeName = animation.ease ?? "none";
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
          className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400"
          title={METHOD_TOOLTIPS[animation.method]}
        >
          {methodLabel}
        </span>
        <span className="text-[11px] font-medium text-neutral-400" title="When this effect plays">
          {typeof animation.position === "number" ? `${animation.position}s` : animation.position} –{" "}
          {typeof endTime === "number" ? `${endTime.toFixed(1)}s` : endTime}
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
            <div className="flex items-start gap-2">
              <p className="flex-1 text-[10px] leading-relaxed text-neutral-400 italic">
                {summary}
              </p>
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
                    : String(Math.max(0, animation.position))
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
                  value={
                    animation.ease?.startsWith("custom(") ? "custom" : (animation.ease ?? "none")
                  }
                  options={[...SUPPORTED_EASES, "custom"]}
                  onChange={(next) => {
                    if (next === "custom") {
                      const points = controlPointsForGsapEase(animation.ease ?? "power2.out");
                      const path = `M0,0 C${points.x1},${points.y1} ${points.x2},${points.y2} 1,1`;
                      onUpdateMeta(animation.id, { ease: `custom(${path})` });
                    } else {
                      onUpdateMeta(animation.id, { ease: next });
                    }
                  }}
                />
                <EaseCurveSection
                  ease={animation.ease ?? "none"}
                  duration={animation.duration}
                  onCustomEaseCommit={(customEase) =>
                    onUpdateMeta(animation.id, { ease: customEase })
                  }
                />
              </>
            )}

            {Object.keys(animation.properties).length > 0 && (
              <div className="space-y-1.5">
                {Object.entries(animation.properties).map(([prop, val]) => (
                  <div key={prop} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <MetricField
                        label={PROP_LABELS[prop] ?? prop}
                        value={
                          isPercentProp(prop) ? String(Math.round(Number(val) * 100)) : String(val)
                        }
                        suffix={PROP_UNITS[prop]}
                        tooltip={PROP_TOOLTIPS[prop]}
                        scrub
                        liveCommit
                        onCommit={(raw) => {
                          const adjusted = isPercentProp(prop) ? String(Number(raw) / 100) : raw;
                          scrubProperty(prop, adjusted);
                          commitProperty(prop, adjusted);
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveProperty(animation.id, prop)}
                      className="flex-shrink-0 rounded p-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-red-400"
                      title={`Remove ${PROP_LABELS[prop] ?? prop}`}
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
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              {addingProp && availableProps.length > 0 ? (
                <select
                  autoFocus
                  className="min-w-0 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] text-neutral-100 outline-none"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) onAddProperty(animation.id, e.target.value);
                    setAddingProp(false);
                  }}
                  onBlur={() => setAddingProp(false)}
                >
                  <option value="" disabled>
                    Choose effect…
                  </option>
                  {availableProps.map((p) => (
                    <option key={p} value={p}>
                      {PROP_LABELS[p] ?? p}
                    </option>
                  ))}
                </select>
              ) : (
                availableProps.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAddingProp(true)}
                    className="text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-200"
                    title="Add another animated property to this effect"
                  >
                    + Effect
                  </button>
                )
              )}
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
