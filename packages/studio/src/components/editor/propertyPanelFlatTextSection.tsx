import { Plus } from "../../icons/SystemIcons";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import type { ImportedFontAsset } from "./fontAssets";
import { normalizeTextMetricValue } from "./propertyPanelHelpers";
import { ColorField } from "./propertyPanelColor";
import { FontFamilyField } from "./propertyPanelFont";
import { FlatRow, FlatSegmentedRow } from "./propertyPanelFlatPrimitives";
import {
  resolveValueTier,
  VALUE_TIER_LABEL_CLASS,
  VALUE_TIER_VALUE_CLASS,
} from "./propertyPanelValueTier";
import {
  detectAvailableWeights,
  getTextFieldColor,
  getTextStyleValue,
  TextAreaField,
  TextSection,
  WEIGHT_LABELS,
} from "./propertyPanelSections";

/* ------------------------------------------------------------------ */
/*  Flat text section (design_handoff_studio_inspector, #10a)          */
/* ------------------------------------------------------------------ */

const ALIGN_OPTIONS = [
  { key: "left", label: "left", node: "L" },
  { key: "center", label: "center", node: "C" },
  { key: "right", label: "right", node: "R" },
  { key: "justify", label: "justify", node: "J" },
];

const CASE_OPTIONS = [
  { key: "none", node: "–" },
  { key: "uppercase", node: "AG" },
  { key: "lowercase", node: "ag" },
];

function FlatTextFieldEditor({
  field,
  styles,
  fontAssets,
  onImportFonts,
  onSetText,
  onSetTextFieldStyle,
}: {
  field: DomEditSelection["textFields"][number];
  styles: Record<string, string>;
  fontAssets: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
}) {
  const weight = getTextStyleValue(field, styles, "font-weight", "400");
  const weightOptions = detectAvailableWeights(
    field.computedStyles["font-family"] || styles["font-family"] || "",
  );
  const align = getTextStyleValue(field, styles, "text-align", "start");
  const textTransform = getTextStyleValue(field, styles, "text-transform", "none");
  const fontStyle = getTextStyleValue(field, styles, "font-style", "normal");

  return (
    <>
      <TextAreaField
        flat
        label="Content"
        value={field.value}
        onCommit={(next) => onSetText(next, field.key)}
      />
      <FontFamilyField
        flat
        value={field.computedStyles["font-family"] || styles["font-family"] || "inherit"}
        importedFonts={fontAssets}
        onImportFonts={onImportFonts}
        onCommit={(next) => onSetTextFieldStyle(field.key, "font-family", next)}
      />
      <FlatRow
        label="Size"
        value={field.computedStyles["font-size"] || styles["font-size"] || "16px"}
        tier={resolveValueTier(field.inlineStyles["font-size"], styles["font-size"] || "16px")}
        onCommit={(next) => onSetTextFieldStyle(field.key, "font-size", next)}
      />
      <div className="flex min-h-[30px] items-center justify-between">
        <span
          className={
            VALUE_TIER_LABEL_CLASS[resolveValueTier(field.inlineStyles["font-weight"], "400")]
          }
          style={{ fontSize: 11 }}
        >
          Weight
        </span>
        <label className="flex items-center gap-1.5">
          <select
            value={weight}
            onChange={(e) => onSetTextFieldStyle(field.key, "font-weight", e.target.value)}
            className={`appearance-none bg-transparent text-right font-mono text-[11px] outline-none ${
              VALUE_TIER_VALUE_CLASS[resolveValueTier(field.inlineStyles["font-weight"], "400")]
            }`}
          >
            {(weightOptions.includes(weight) ? weightOptions : [weight, ...weightOptions]).map(
              (option) => (
                <option key={option} value={option}>
                  {WEIGHT_LABELS[option] ?? option}
                </option>
              ),
            )}
          </select>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="currentColor"
            className="flex-shrink-0 text-panel-text-5"
          >
            <path d="M2 3l3 4 3-4z" />
          </svg>
        </label>
      </div>
      <FlatRow
        label="Letter spacing"
        value={getTextStyleValue(field, styles, "letter-spacing", "0px")}
        tier={resolveValueTier(field.inlineStyles["letter-spacing"], "0px")}
        onCommit={(next) =>
          onSetTextFieldStyle(
            field.key,
            "letter-spacing",
            normalizeTextMetricValue("letter-spacing", next),
          )
        }
        onReset={() => onSetTextFieldStyle(field.key, "letter-spacing", "")}
      />
      <FlatRow
        label="Line height"
        value={getTextStyleValue(field, styles, "line-height", "normal")}
        tier={resolveValueTier(field.inlineStyles["line-height"], "normal")}
        onCommit={(next) =>
          onSetTextFieldStyle(
            field.key,
            "line-height",
            normalizeTextMetricValue("line-height", next),
          )
        }
        onReset={() => onSetTextFieldStyle(field.key, "line-height", "")}
      />
      <FlatSegmentedRow
        label="Align"
        options={ALIGN_OPTIONS.map((option) => ({
          key: option.key,
          node: option.node,
          active: align === option.key || (option.key === "left" && align === "start"),
        }))}
        onChange={(next) => onSetTextFieldStyle(field.key, "text-align", next)}
      />
      <FlatSegmentedRow
        label="Case · Style"
        options={[
          ...CASE_OPTIONS.map((option) => ({
            key: option.key,
            node: option.node,
            active: textTransform === option.key,
          })),
          { key: "normal", node: "A", active: fontStyle === "normal" },
          { key: "italic", node: "A", active: fontStyle === "italic" },
        ]}
        spacerAfterIndex={2}
        onChange={(next) => {
          if (next === "normal" || next === "italic") {
            onSetTextFieldStyle(field.key, "font-style", next);
          } else {
            onSetTextFieldStyle(field.key, "text-transform", next);
          }
        }}
      />
      <ColorField
        flat
        label="Color"
        value={getTextFieldColor(field, styles)}
        onCommit={(next) => onSetTextFieldStyle(field.key, "color", next)}
      />
    </>
  );
}

export function FlatTextSection({
  element,
  styles,
  fontAssets,
  onImportFonts,
  onSetText,
  onSetTextFieldStyle,
  onAddTextField,
  onRemoveTextField,
}: {
  element: DomEditSelection;
  styles: Record<string, string>;
  fontAssets: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onAddTextField: (afterFieldKey?: string) => string | Promise<string | null> | null;
  onRemoveTextField: (fieldKey: string) => void;
}) {
  if (!isTextEditableSelection(element)) return null;
  const textFields = element.textFields;
  const activeField = textFields[0];
  if (!activeField) return null;

  if (textFields.length > 1) {
    return (
      <TextSection
        element={element}
        styles={styles}
        fontAssets={fontAssets}
        onImportFonts={onImportFonts}
        onSetText={onSetText}
        onSetTextFieldStyle={onSetTextFieldStyle}
        onAddTextField={onAddTextField}
        onRemoveTextField={onRemoveTextField}
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <FlatTextFieldEditor
        field={activeField}
        styles={styles}
        fontAssets={fontAssets}
        onImportFonts={onImportFonts}
        onSetText={onSetText}
        onSetTextFieldStyle={onSetTextFieldStyle}
      />
      <button
        type="button"
        onClick={() => void onAddTextField(activeField.key)}
        className="mt-0.5 flex items-center gap-[5px] text-[10px] text-panel-text-4 hover:text-panel-text-2"
      >
        <Plus size={10} />
        Add text field
      </button>
    </div>
  );
}
