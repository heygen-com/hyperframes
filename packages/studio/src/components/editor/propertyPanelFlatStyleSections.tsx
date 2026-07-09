// fallow-ignore-file code-duplication
import { useEffect, useState } from "react";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import { buildDefaultGradientModel, serializeGradient } from "./gradientValue";
import { extractBackgroundImageUrl } from "./propertyPanelHelpers";
// oxlint-disable-next-line no-unused-vars
import { FlatRow, FlatSegmentedRow } from "./propertyPanelFlatPrimitives";
// oxlint-disable-next-line no-unused-vars
import { resolveValueTier } from "./propertyPanelValueTier";
import { ColorField } from "./propertyPanelColor";
import { GradientField, ImageFillField } from "./propertyPanelFill";

/* ------------------------------------------------------------------ */
/*  Flat Fill sub-block (design_handoff_studio_inspector, #11a)        */
/* ------------------------------------------------------------------ */

// fallow-ignore-next-line complexity
function FlatFillFields({
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
      <FlatSegmentedRow
        label="Fill"
        options={[
          { key: "Solid", node: "Solid", active: preferredFillMode === "Solid" },
          { key: "Gradient", node: "Gradient", active: preferredFillMode === "Gradient" },
          { key: "Image", node: "Image", active: preferredFillMode === "Image" },
        ]}
        disabled={styleEditingDisabled}
        onChange={handleFillModeChange}
      />
      {preferredFillMode === "Solid" ? (
        <ColorField
          flat
          label="Color"
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
          flat
          label="Text color"
          value={styles.color ?? "rgb(0, 0, 0)"}
          disabled={styleEditingDisabled}
          onCommit={(next) => onSetStyle("color", next)}
        />
      )}
    </>
  );
}

export function FlatStyleSection({
  projectId,
  element,
  styles,
  assets,
  onSetStyle,
  onImportAssets,
  // oxlint-disable-next-line no-unused-vars
  gsapBorderRadius,
}: {
  projectId: string;
  element: DomEditSelection;
  styles: Record<string, string>;
  assets: string[];
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onImportAssets?: (files: FileList) => Promise<string[]>;
  gsapBorderRadius?: { tl: number; tr: number; br: number; bl: number } | null;
}) {
  return (
    <div className="space-y-1.5">
      <FlatFillFields
        projectId={projectId}
        element={element}
        styles={styles}
        assets={assets}
        onSetStyle={onSetStyle}
        onImportAssets={onImportAssets}
      />
    </div>
  );
}
