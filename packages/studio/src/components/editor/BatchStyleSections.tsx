import type { DomEditSelection } from "./domEditingTypes";
import {
  formatNumericValue,
  formatPxMetricValue,
  normalizePanelPxValue,
  parseNumericValue,
  parsePxMetricValue,
  RESPONSIVE_GRID,
} from "./propertyPanelHelpers";
import { ColorField } from "./propertyPanelColor";
import {
  FieldLabel,
  MetricField,
  Section,
  SelectField,
  SliderControl,
} from "./propertyPanelPrimitives";

const MIXED_VALUE = "Mixed";

interface SharedValue<T> {
  mixed: boolean;
  value: T;
}

function getSharedValue<T>(values: readonly T[], fallback: T): SharedValue<T> {
  const value = values[0] ?? fallback;
  return { value, mixed: values.some((candidate) => !Object.is(candidate, value)) };
}

export function BatchStyleSections({
  selections,
  onBatchStyleCommit,
}: {
  selections: DomEditSelection[];
  onBatchStyleCommit: (
    selections: DomEditSelection[],
    property: string,
    value: string | null,
  ) => void | Promise<void>;
}) {
  const editableSelections = selections.filter((selection) => selection.capabilities.canEditStyles);
  const opacity = getSharedValue(
    editableSelections.map((selection) =>
      Math.round((parseNumericValue(selection.computedStyles.opacity) ?? 1) * 100),
    ),
    100,
  );
  const fillColor = getSharedValue(
    editableSelections.map(
      (selection) => selection.computedStyles["background-color"] ?? "transparent",
    ),
    "transparent",
  );
  const strokeWidth = getSharedValue(
    editableSelections.map((selection) =>
      formatPxMetricValue(
        parsePxMetricValue(selection.computedStyles["border-width"] ?? "") ??
          parsePxMetricValue(selection.computedStyles["border-top-width"] ?? "") ??
          0,
      ),
    ),
    "0px",
  );
  const strokeStyle = getSharedValue(
    editableSelections.map(
      (selection) =>
        selection.computedStyles["border-style"] ||
        selection.computedStyles["border-top-style"] ||
        "none",
    ),
    "none",
  );
  const strokeColor = getSharedValue(
    editableSelections.map(
      (selection) =>
        selection.computedStyles["border-color"] ||
        selection.computedStyles["border-top-color"] ||
        "rgba(255, 255, 255, 0.18)",
    ),
    "rgba(255, 255, 255, 0.18)",
  );
  const selectionCount = selections.length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg text-panel-text-1">
      <div className="px-4 py-3">
        <div className="text-[13px] font-semibold text-neutral-100">
          {selectionCount} elements selected
        </div>
        {editableSelections.length !== selectionCount && (
          <p className="mt-1 text-[11px] text-neutral-400">
            {editableSelections.length} of {selectionCount} selected elements are editable
          </p>
        )}
        <p className="mt-2 text-[11px] leading-4 text-neutral-500">
          Batch editing covers opacity, fill, and stroke only.
        </p>
      </div>

      {editableSelections.length === 0 ? (
        <p className="border-t border-panel-border px-4 py-3 text-[11px] text-neutral-500">
          No selected elements support batch style editing.
        </p>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <Section title="Transparency">
            <div className="grid min-w-0 gap-1.5">
              <FieldLabel label="Opacity" />
              <SliderControl
                value={opacity.value}
                min={0}
                max={100}
                step={1}
                displayValue={opacity.mixed ? MIXED_VALUE : `${opacity.value}%`}
                formatDisplayValue={opacity.mixed ? undefined : (next) => `${Math.round(next)}%`}
                onCommit={(next) =>
                  void onBatchStyleCommit(
                    editableSelections,
                    "opacity",
                    formatNumericValue(next / 100),
                  )
                }
              />
            </div>
          </Section>

          <Section title="Fill">
            <ColorField
              label="Fill color"
              value={fillColor.mixed ? MIXED_VALUE : fillColor.value}
              onCommit={(next) =>
                void onBatchStyleCommit(editableSelections, "background-color", next)
              }
            />
          </Section>

          <Section title="Stroke">
            <div className="space-y-4">
              <div className={RESPONSIVE_GRID}>
                <MetricField
                  label="Width"
                  value={strokeWidth.mixed ? MIXED_VALUE : strokeWidth.value}
                  liveCommit
                  onCommit={(next) => {
                    const normalized = normalizePanelPxValue(next, {
                      min: 0,
                      max: 200,
                      fallback: parsePxMetricValue(strokeWidth.value) ?? 0,
                    });
                    if (normalized) {
                      void onBatchStyleCommit(editableSelections, "border-width", normalized);
                    }
                  }}
                />
                <SelectField
                  label="Style"
                  value={strokeStyle.mixed ? MIXED_VALUE : strokeStyle.value}
                  disableUnlistedValue
                  onChange={(next) =>
                    void onBatchStyleCommit(editableSelections, "border-style", next)
                  }
                  options={["none", "solid", "dashed", "dotted", "double"]}
                />
              </div>
              <ColorField
                label="Stroke color"
                value={strokeColor.mixed ? MIXED_VALUE : strokeColor.value}
                onCommit={(next) =>
                  void onBatchStyleCommit(editableSelections, "border-color", next)
                }
              />
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
