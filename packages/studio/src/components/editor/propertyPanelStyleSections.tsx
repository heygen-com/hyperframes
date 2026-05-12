import { useEffect, useState } from "react";
import { Eye, Layers, Palette, Settings, Square, Zap } from "../../icons/SystemIcons";
import { buildDefaultGradientModel, serializeGradient } from "./gradientValue";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import {
  buildBoxShadowPresetValue,
  buildClipPathValue,
  buildInsetClipPathValue,
  buildStrokeStyleUpdates,
  buildStrokeWidthStyleUpdates,
  extractBackgroundImageUrl,
  formatNumericValue,
  formatPxMetricValue,
  getCssFilterFunctionPx,
  getClipPathInsetPx,
  inferBoxShadowPreset,
  inferClipPathPreset,
  LABEL,
  normalizePanelPxValue,
  parseNumericValue,
  parsePxMetricValue,
  RESPONSIVE_GRID,
  setCssFilterFunctionPx,
  type BoxShadowPreset,
} from "./propertyPanelHelpers";
import {
  DetailField,
  MetricField,
  Section,
  SegmentedControl,
  SelectField,
  SliderControl,
} from "./propertyPanelPrimitives";
import { ColorField } from "./propertyPanelColor";
import { GradientField, ImageFillField } from "./propertyPanelFill";

export function StyleSections({
  projectId,
  element,
  styles,
  assets,
  onSetStyle,
  onImportAssets,
}: {
  projectId: string;
  element: DomEditSelection;
  styles: Record<string, string>;
  assets: string[];
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onImportAssets?: (files: FileList) => Promise<string[]>;
}) {
  const styleEditingDisabled = !element.capabilities.canEditStyles;
  const isFlex = styles.display === "flex" || styles.display === "inline-flex";
  const radiusValue = parseNumericValue(styles["border-radius"]) ?? 0;
  const opacityValue = Math.round((parseNumericValue(styles.opacity) ?? 1) * 100);
  const borderWidthValue =
    parsePxMetricValue(styles["border-width"] ?? "") ??
    parsePxMetricValue(styles["border-top-width"] ?? "") ??
    0;
  const hasVisualBackground =
    (styles.background != null && styles.background !== "none" && styles.background !== "") ||
    (styles["background-color"] != null &&
      styles["background-color"] !== "transparent" &&
      styles["background-color"] !== "rgba(0, 0, 0, 0)" &&
      styles["background-color"] !== "") ||
    (styles["background-image"] != null &&
      styles["background-image"] !== "none" &&
      styles["background-image"] !== "") ||
    borderWidthValue > 0;
  const borderStyleValue = styles["border-style"] || styles["border-top-style"] || "none";
  const borderColorValue =
    styles["border-color"] || styles["border-top-color"] || "rgba(255, 255, 255, 0.18)";
  const boxShadowPreset = inferBoxShadowPreset(styles["box-shadow"]);
  const filterBlurValue = getCssFilterFunctionPx(styles.filter, "blur");
  const backdropBlurValue = getCssFilterFunctionPx(styles["backdrop-filter"], "blur");
  const clipPathValue = styles["clip-path"] || "none";
  const clipPathPreset = inferClipPathPreset(clipPathValue);
  const clipInsetValue = getClipPathInsetPx(clipPathValue);
  const backgroundImage = styles["background-image"] ?? "none";
  const hasTextControls = isTextEditableSelection(element);

  const fillMode =
    backgroundImage && backgroundImage !== "none"
      ? backgroundImage.includes("gradient")
        ? "Gradient"
        : "Image"
      : "Solid";
  const [preferredFillMode, setPreferredFillMode] = useState(fillMode);
  const imageUrl = extractBackgroundImageUrl(backgroundImage);

  useEffect(() => {
    setPreferredFillMode(fillMode);
  }, [fillMode, element.id, element.selector, backgroundImage]);

  const handleFillModeChange = (nextMode: string) => {
    setPreferredFillMode(nextMode);
    if (nextMode === "Solid") {
      onSetStyle("background-image", "none");
      return;
    }
    if (nextMode === "Gradient" && !backgroundImage.includes("gradient")) {
      onSetStyle(
        "background-image",
        serializeGradient(buildDefaultGradientModel(styles["background-color"])),
      );
    }
  };

  return (
    <>
      {isFlex && (
        <Section title="Flex" icon={<Layers size={15} />}>
          <div className="space-y-4">
            <SegmentedControl
              disabled={styleEditingDisabled}
              value={styles["flex-direction"] || "row"}
              onChange={(next) => onSetStyle("flex-direction", next)}
              options={[
                { label: "→ Row", value: "row" },
                { label: "↓ Column", value: "column" },
              ]}
            />
            <div className={RESPONSIVE_GRID}>
              <SelectField
                label="Justify"
                value={styles["justify-content"] || "flex-start"}
                disabled={styleEditingDisabled}
                onChange={(next) => onSetStyle("justify-content", next)}
                options={[
                  "flex-start",
                  "center",
                  "space-between",
                  "space-around",
                  "space-evenly",
                  "flex-end",
                ]}
              />
              <SelectField
                label="Align"
                value={styles["align-items"] || "stretch"}
                disabled={styleEditingDisabled}
                onChange={(next) => onSetStyle("align-items", next)}
                options={["stretch", "flex-start", "center", "flex-end", "baseline"]}
              />
            </div>
            <DetailField
              label="Gap"
              value={styles.gap ?? "0px"}
              disabled={styleEditingDisabled}
              onCommit={(next) => onSetStyle("gap", next.endsWith("px") ? next : `${next}px`)}
            />
          </div>
        </Section>
      )}

      {hasVisualBackground && (
        <Section title="Radius" icon={<Settings size={15} />}>
          <SliderControl
            value={radiusValue}
            min={0}
            max={Math.max(240, Math.ceil(radiusValue))}
            step={1}
            disabled={styleEditingDisabled}
            displayValue={`${formatNumericValue(radiusValue)}px`}
            formatDisplayValue={(next) => `${formatNumericValue(next)}px`}
            onCommit={(next) => onSetStyle("border-radius", `${formatNumericValue(next)}px`)}
          />
        </Section>
      )}

      <Section title="Stroke" icon={<Square size={15} />}>
        <div className="space-y-4">
          <div className={RESPONSIVE_GRID}>
            <MetricField
              label="Width"
              value={formatPxMetricValue(borderWidthValue)}
              disabled={styleEditingDisabled}
              liveCommit
              onCommit={async (next) => {
                const normalized = normalizePanelPxValue(next, {
                  min: 0,
                  max: 200,
                  fallback: borderWidthValue,
                });
                if (!normalized) return;
                for (const [property, value] of buildStrokeWidthStyleUpdates(
                  normalized,
                  borderStyleValue,
                )) {
                  await onSetStyle(property, value);
                }
              }}
            />
            <SelectField
              label="Style"
              value={borderStyleValue}
              disabled={styleEditingDisabled}
              onChange={async (next) => {
                for (const [property, value] of buildStrokeStyleUpdates(
                  next,
                  formatPxMetricValue(borderWidthValue),
                )) {
                  await onSetStyle(property, value);
                }
              }}
              options={[
                "none",
                "solid",
                "dashed",
                "dotted",
                "double",
                "hidden",
                "groove",
                "ridge",
                "inset",
                "outset",
              ]}
            />
          </div>
          <ColorField
            label="Stroke color"
            value={borderColorValue}
            disabled={styleEditingDisabled}
            onCommit={(next) => onSetStyle("border-color", next)}
          />
        </div>
      </Section>

      <Section title="Effects" icon={<Zap size={15} />}>
        <div className="space-y-4">
          <SelectField
            label="Shadow"
            value={boxShadowPreset}
            disabled={styleEditingDisabled}
            onChange={(next) => {
              if (next === "custom") return;
              onSetStyle(
                "box-shadow",
                buildBoxShadowPresetValue(next as BoxShadowPreset, styles["box-shadow"]),
              );
            }}
            options={["custom", "none", "soft", "lift", "glow"]}
          />
          <div className={RESPONSIVE_GRID}>
            <div className="grid min-w-0 gap-1.5">
              <span className={LABEL}>Layer blur</span>
              <SliderControl
                value={filterBlurValue}
                min={0}
                max={Math.max(40, Math.ceil(filterBlurValue))}
                step={1}
                disabled={styleEditingDisabled}
                displayValue={`${formatNumericValue(filterBlurValue)}px`}
                formatDisplayValue={(next) => `${formatNumericValue(next)}px`}
                onCommit={(next) =>
                  onSetStyle("filter", setCssFilterFunctionPx(styles.filter, "blur", next))
                }
              />
            </div>
            <div className="grid min-w-0 gap-1.5">
              <span className={LABEL}>Backdrop</span>
              <SliderControl
                value={backdropBlurValue}
                min={0}
                max={Math.max(60, Math.ceil(backdropBlurValue))}
                step={1}
                disabled={styleEditingDisabled}
                displayValue={`${formatNumericValue(backdropBlurValue)}px`}
                formatDisplayValue={(next) => `${formatNumericValue(next)}px`}
                onCommit={(next) =>
                  onSetStyle(
                    "backdrop-filter",
                    setCssFilterFunctionPx(styles["backdrop-filter"], "blur", next),
                  )
                }
              />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Clip" icon={<Layers size={15} />}>
        <div className="space-y-4">
          <div className={RESPONSIVE_GRID}>
            <SelectField
              label="Overflow"
              value={styles.overflow || "visible"}
              disabled={styleEditingDisabled}
              onChange={(next) => onSetStyle("overflow", next)}
              options={["visible", "hidden", "clip", "auto", "scroll"]}
            />
            <SelectField
              label="Mask"
              value={clipPathPreset}
              disabled={styleEditingDisabled}
              onChange={(next) => {
                if (next === "custom") return;
                onSetStyle(
                  "clip-path",
                  buildClipPathValue(
                    next as "none" | "inset" | "circle",
                    radiusValue,
                    clipPathValue,
                  ),
                );
              }}
              options={["custom", "none", "inset", "circle"]}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <span className={LABEL}>Mask inset</span>
            <SliderControl
              value={clipInsetValue}
              min={0}
              max={Math.max(120, Math.ceil(clipInsetValue))}
              step={1}
              disabled={styleEditingDisabled}
              displayValue={`${formatNumericValue(clipInsetValue)}px`}
              formatDisplayValue={(next) => `${formatNumericValue(next)}px`}
              onCommit={(next) =>
                onSetStyle("clip-path", buildInsetClipPathValue(next, radiusValue))
              }
            />
          </div>
        </div>
      </Section>

      <Section title="Transparency" icon={<Eye size={15} />}>
        <div className="space-y-4">
          <SliderControl
            value={opacityValue}
            min={0}
            max={100}
            step={1}
            disabled={styleEditingDisabled}
            displayValue={`${opacityValue}%`}
            formatDisplayValue={(next) => `${Math.round(next)}%`}
            onCommit={(next) => onSetStyle("opacity", formatNumericValue(next / 100))}
          />
          <SelectField
            label="Mode"
            value={styles["mix-blend-mode"] || "normal"}
            disabled={styleEditingDisabled}
            onChange={(next) => onSetStyle("mix-blend-mode", next)}
            options={["normal", "multiply", "screen", "overlay", "darken", "lighten"]}
          />
        </div>
      </Section>

      <Section
        title="Fill"
        icon={<Palette size={15} />}
        accessory={
          <div className="rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-neutral-400">
            {preferredFillMode}
          </div>
        }
      >
        <div className="space-y-4">
          <SegmentedControl
            disabled={styleEditingDisabled}
            value={preferredFillMode}
            onChange={handleFillModeChange}
            options={[
              { label: "Solid", value: "Solid" },
              { label: "Gradient", value: "Gradient" },
              { label: "Image", value: "Image" },
            ]}
          />
          {preferredFillMode === "Solid" ? (
            <ColorField
              label="Fill color"
              value={styles["background-color"] ?? "transparent"}
              disabled={styleEditingDisabled}
              onCommit={(next) => onSetStyle("background-color", next)}
            />
          ) : preferredFillMode === "Gradient" ? (
            <GradientField
              value={
                backgroundImage !== "none"
                  ? backgroundImage
                  : serializeGradient(buildDefaultGradientModel(styles["background-color"]))
              }
              fallbackColor={styles["background-color"]}
              disabled={styleEditingDisabled}
              onCommit={(next) => onSetStyle("background-image", next)}
            />
          ) : (
            <ImageFillField
              projectId={projectId}
              sourceFile={element.sourceFile}
              value={imageUrl}
              assets={assets}
              disabled={styleEditingDisabled}
              onCommit={(next) => onSetStyle("background-image", next)}
              onImportAssets={onImportAssets}
            />
          )}
          {!hasTextControls && (
            <ColorField
              label="Text color"
              value={styles.color ?? "rgb(0, 0, 0)"}
              disabled={styleEditingDisabled}
              onCommit={(next) => onSetStyle("color", next)}
            />
          )}
        </div>
      </Section>
    </>
  );
}
