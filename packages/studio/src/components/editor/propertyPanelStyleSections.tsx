import { useEffect, useState } from "react";
import { buildDefaultGradientModel, serializeGradient } from "./gradientValue";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import {
  buildBoxShadowPresetValue,
  buildClipPathValue,
  buildInsetClipPathSides,
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
  normalizePanelPxValue,
  parseInsetClipPathSides,
  parseNumericValue,
  parsePxMetricValue,
  RESPONSIVE_GRID,
  setCssFilterFunctionPx,
  type ClipPathInsetSides,
  type BoxShadowPreset,
} from "./propertyPanelHelpers";
import {
  DetailField,
  FieldLabel,
  MetricField,
  Section,
  SegmentedControl,
  SelectField,
  SliderControl,
} from "./propertyPanelPrimitives";
import { ColorField } from "./propertyPanelColor";
import { GradientField, ImageFillField } from "./propertyPanelFill";
import { BorderRadiusEditor } from "./BorderRadiusEditor";

// fallow-ignore-next-line complexity
export function StyleSections({
  projectId,
  element,
  styles,
  assets,
  onSetStyle,
  onImportAssets,
  gsapBorderRadius,
}: {
  projectId: string;
  element: DomEditSelection;
  styles: Record<string, string>;
  assets: string[];
  onSetStyle: (prop: string, value: string | null) => void | Promise<void>;
  onImportAssets?: (files: FileList) => Promise<string[]>;
  gsapBorderRadius?: { tl: number; tr: number; br: number; bl: number } | null;
}) {
  const styleEditingDisabled = !element.capabilities.canEditStyles;
  const isFlex = styles.display === "flex" || styles.display === "inline-flex";
  const radiusValue = parseNumericValue(styles["border-radius"]) ?? 0;
  const radiusTL =
    gsapBorderRadius?.tl ?? parseNumericValue(styles["border-top-left-radius"]) ?? radiusValue;
  const radiusTR =
    gsapBorderRadius?.tr ?? parseNumericValue(styles["border-top-right-radius"]) ?? radiusValue;
  const radiusBR =
    gsapBorderRadius?.br ?? parseNumericValue(styles["border-bottom-right-radius"]) ?? radiusValue;
  const radiusBL =
    gsapBorderRadius?.bl ?? parseNumericValue(styles["border-bottom-left-radius"]) ?? radiusValue;
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
  const parsedClipInsets = parseInsetClipPathSides(clipPathValue);
  const clipInsetValue = getClipPathInsetPx(clipPathValue);
  const clipInsetSides = parsedClipInsets ?? {
    top: clipInsetValue,
    right: clipInsetValue,
    bottom: clipInsetValue,
    left: clipInsetValue,
    radius: radiusValue,
  };
  const showClipInsetSides = clipPathPreset === "inset" || parsedClipInsets != null;
  const backgroundImage = styles["background-image"] ?? "none";
  const hasTextControls = isTextEditableSelection(element);
  const resetInlineStyle = (...properties: string[]): (() => void) | undefined => {
    const property = properties.find((candidate) => Object.hasOwn(element.inlineStyles, candidate));
    if (property === undefined) return undefined;
    return () => {
      void onSetStyle(property, null);
    };
  };

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

  const commitClipInsetSide = (side: keyof ClipPathInsetSides, nextValue: string) => {
    const next = parsePxMetricValue(nextValue);
    if (next == null) return;
    const sides: ClipPathInsetSides = {
      top: clipInsetSides.top,
      right: clipInsetSides.right,
      bottom: clipInsetSides.bottom,
      left: clipInsetSides.left,
    };
    sides[side] = next;
    onSetStyle("clip-path", buildInsetClipPathSides(sides, clipInsetSides.radius));
  };

  return (
    <>
      {isFlex && (
        <Section
          title="Flex"
          disabledReason={styleEditingDisabled ? element.capabilities.reasonIfDisabled : undefined}
          defaultCollapsed
        >
          <div className="space-y-4">
            <div className="grid min-w-0 gap-1.5">
              <FieldLabel
                label="Direction"
                disabled={styleEditingDisabled}
                onReset={resetInlineStyle("flex-direction")}
              />
              <SegmentedControl
                disabled={styleEditingDisabled}
                value={styles["flex-direction"] || "row"}
                onChange={(next) => onSetStyle("flex-direction", next)}
                options={[
                  { label: "→ Row", value: "row" },
                  { label: "↓ Column", value: "column" },
                ]}
              />
            </div>
            <div className={RESPONSIVE_GRID}>
              <SelectField
                label="Justify"
                value={styles["justify-content"] || "flex-start"}
                disabled={styleEditingDisabled}
                onReset={resetInlineStyle("justify-content")}
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
                onReset={resetInlineStyle("align-items")}
                onChange={(next) => onSetStyle("align-items", next)}
                options={["stretch", "flex-start", "center", "flex-end", "baseline"]}
              />
            </div>
            <DetailField
              label="Gap"
              value={styles.gap ?? "0px"}
              disabled={styleEditingDisabled}
              onReset={resetInlineStyle("gap")}
              onCommit={(next) => onSetStyle("gap", next.endsWith("px") ? next : `${next}px`)}
            />
          </div>
        </Section>
      )}

      {hasVisualBackground && (
        <Section
          title="Radius"
          disabledReason={styleEditingDisabled ? element.capabilities.reasonIfDisabled : undefined}
          defaultCollapsed
        >
          <BorderRadiusEditor
            tl={radiusTL}
            tr={radiusTR}
            br={radiusBR}
            bl={radiusBL}
            disabled={styleEditingDisabled}
            resets={{
              all: resetInlineStyle("border-radius"),
              tl: resetInlineStyle("border-top-left-radius"),
              tr: resetInlineStyle("border-top-right-radius"),
              br: resetInlineStyle("border-bottom-right-radius"),
              bl: resetInlineStyle("border-bottom-left-radius"),
            }}
            onCommit={(corner, value) => {
              const px = `${formatNumericValue(value)}px`;
              if (corner === "all") {
                onSetStyle("border-radius", px);
              } else {
                const prop = {
                  tl: "border-top-left-radius",
                  tr: "border-top-right-radius",
                  br: "border-bottom-right-radius",
                  bl: "border-bottom-left-radius",
                }[corner];
                onSetStyle(prop, px);
              }
            }}
          />
        </Section>
      )}

      <Section
        title="Stroke"
        disabledReason={styleEditingDisabled ? element.capabilities.reasonIfDisabled : undefined}
        defaultCollapsed
      >
        <div className="space-y-4">
          <div className={RESPONSIVE_GRID}>
            <MetricField
              label="Width"
              value={formatPxMetricValue(borderWidthValue)}
              disabled={styleEditingDisabled}
              liveCommit
              onReset={resetInlineStyle("border-width", "border-top-width")}
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
              onReset={resetInlineStyle("border-style", "border-top-style")}
              onChange={async (next) => {
                for (const [property, value] of buildStrokeStyleUpdates(
                  next,
                  formatPxMetricValue(borderWidthValue),
                )) {
                  await onSetStyle(property, value);
                }
              }}
              options={["none", "solid", "dashed", "dotted", "double"]}
            />
          </div>
          <ColorField
            label="Stroke color"
            value={borderColorValue}
            disabled={styleEditingDisabled}
            onReset={resetInlineStyle("border-color", "border-top-color")}
            onCommit={(next) => onSetStyle("border-color", next)}
          />
        </div>
      </Section>

      <Section
        title="Effects"
        disabledReason={styleEditingDisabled ? element.capabilities.reasonIfDisabled : undefined}
        defaultCollapsed
      >
        <div className="space-y-4">
          <SelectField
            label="Shadow"
            value={boxShadowPreset}
            disabled={styleEditingDisabled}
            disableUnlistedValue
            onReset={resetInlineStyle("box-shadow")}
            onChange={(next) => {
              onSetStyle(
                "box-shadow",
                buildBoxShadowPresetValue(next as BoxShadowPreset, styles["box-shadow"]),
              );
            }}
            options={["none", "soft", "lift", "glow"]}
          />
          <div className={RESPONSIVE_GRID}>
            <div className="grid min-w-0 gap-1.5">
              <FieldLabel
                label="Layer blur"
                disabled={styleEditingDisabled}
                onReset={resetInlineStyle("filter")}
              />
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
              <FieldLabel
                label="Backdrop"
                disabled={styleEditingDisabled}
                onReset={resetInlineStyle("backdrop-filter")}
              />
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

      <Section
        title="Clip"
        disabledReason={styleEditingDisabled ? element.capabilities.reasonIfDisabled : undefined}
        defaultCollapsed
      >
        <div className="space-y-4">
          <div className={RESPONSIVE_GRID}>
            <SelectField
              label="Overflow"
              value={styles.overflow || "visible"}
              disabled={styleEditingDisabled}
              onReset={resetInlineStyle("overflow")}
              onChange={(next) => onSetStyle("overflow", next)}
              options={["visible", "hidden", "clip"]}
            />
            <SelectField
              label="Mask"
              value={clipPathPreset}
              disabled={styleEditingDisabled}
              disableUnlistedValue
              onReset={resetInlineStyle("clip-path")}
              onChange={(next) => {
                onSetStyle(
                  "clip-path",
                  buildClipPathValue(
                    next as "none" | "inset" | "circle",
                    radiusValue,
                    clipPathValue,
                  ),
                );
              }}
              options={["none", "inset", "circle"]}
            />
          </div>
          <div className="grid min-w-0 gap-1.5">
            <FieldLabel
              label="Mask inset"
              disabled={styleEditingDisabled}
              onReset={resetInlineStyle("clip-path")}
            />
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
          {showClipInsetSides && (
            <div className="grid gap-2">
              <div className="grid grid-cols-4 gap-2">
                <MetricField
                  label="T"
                  value={formatPxMetricValue(clipInsetSides.top)}
                  disabled={styleEditingDisabled}
                  onReset={resetInlineStyle("clip-path")}
                  onCommit={(next) => commitClipInsetSide("top", next)}
                />
                <MetricField
                  label="R"
                  value={formatPxMetricValue(clipInsetSides.right)}
                  disabled={styleEditingDisabled}
                  onReset={resetInlineStyle("clip-path")}
                  onCommit={(next) => commitClipInsetSide("right", next)}
                />
                <MetricField
                  label="B"
                  value={formatPxMetricValue(clipInsetSides.bottom)}
                  disabled={styleEditingDisabled}
                  onReset={resetInlineStyle("clip-path")}
                  onCommit={(next) => commitClipInsetSide("bottom", next)}
                />
                <MetricField
                  label="L"
                  value={formatPxMetricValue(clipInsetSides.left)}
                  disabled={styleEditingDisabled}
                  onReset={resetInlineStyle("clip-path")}
                  onCommit={(next) => commitClipInsetSide("left", next)}
                />
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Transparency"
        disabledReason={styleEditingDisabled ? element.capabilities.reasonIfDisabled : undefined}
        defaultCollapsed
      >
        <div className="space-y-4">
          <div className="grid min-w-0 gap-1.5">
            <FieldLabel
              label="Opacity"
              disabled={styleEditingDisabled}
              onReset={resetInlineStyle("opacity")}
            />
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
          </div>
          <SelectField
            label="Mode"
            value={styles["mix-blend-mode"] || "normal"}
            disabled={styleEditingDisabled}
            onReset={resetInlineStyle("mix-blend-mode")}
            onChange={(next) => onSetStyle("mix-blend-mode", next)}
            options={["normal", "multiply", "screen", "overlay", "darken", "lighten"]}
          />
        </div>
      </Section>

      <Section
        title="Fill"
        disabledReason={styleEditingDisabled ? element.capabilities.reasonIfDisabled : undefined}
      >
        <div className="space-y-4">
          <div className="grid min-w-0 gap-1.5">
            <FieldLabel
              label="Fill mode"
              disabled={styleEditingDisabled}
              onReset={resetInlineStyle("background-image")}
            />
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
          </div>
          {preferredFillMode === "Solid" ? (
            <ColorField
              label="Fill color"
              value={styles["background-color"] ?? "transparent"}
              disabled={styleEditingDisabled}
              onReset={resetInlineStyle("background-color")}
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
              onReset={resetInlineStyle("color")}
              onCommit={(next) => onSetStyle("color", next)}
            />
          )}
        </div>
      </Section>
    </>
  );
}
