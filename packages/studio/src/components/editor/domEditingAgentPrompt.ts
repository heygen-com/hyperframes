/**
 * Agent prompt builder for HyperFrames element edit requests.
 */
import { formatTime } from "../../player/lib/time";
import type { DomEditSelection, DomEditTextField } from "./domEditingTypes";

function formatBoundingBox(bounds: DomEditSelection["boundingBox"]): string {
  return `x=${Math.round(bounds.x)}, y=${Math.round(bounds.y)}, width=${Math.round(bounds.width)}, height=${Math.round(bounds.height)}`;
}

function formatStyleBlock(styles: Record<string, string>): string {
  return Object.entries(styles)
    .filter(([, value]) => value && value !== "initial")
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function formatTextFields(fields: DomEditTextField[]): string {
  return fields
    .map(
      (field) =>
        `- key=${field.key}; tag=<${field.tagName}>; source=${field.source}; text=${JSON.stringify(field.value)}`,
    )
    .join("\n");
}

/** One line per co-selected element, so a multi-select edit names every target. */
function formatAlsoSelected(selections: DomEditSelection[]): string {
  return selections
    .map((selection) => {
      const text = selection.textContent ? `; text=${JSON.stringify(selection.textContent)}` : "";
      return `- <${selection.tagName}> id=${selection.id ?? "(none)"}; selector=${selection.selector ?? "(none)"}; index=${selection.selectorIndex ?? 0}; bounds=${formatBoundingBox(selection.boundingBox)}${text}`;
    })
    .join("\n");
}

export function buildElementAgentPrompt({
  selection,
  alsoSelected = [],
  currentTime,
  tagSnippet,
  selectionContext,
  userInstruction,
  sourceFilePath,
}: {
  selection: DomEditSelection;
  /** The rest of a multi-selection; the instruction applies to all of them. */
  alsoSelected?: DomEditSelection[];
  currentTime: number;
  tagSnippet?: string;
  selectionContext?: string;
  userInstruction?: string;
  sourceFilePath?: string;
}): string {
  const displayedSourceFile = sourceFilePath?.trim() || selection.sourceFile;
  const lines = [
    "## HyperFrames element edit request v1",
    "Schema version: 1",
    "",
    userInstruction?.trim() || "Edit this selected HyperFrames element.",
    "",
    `Composition: ${selection.compositionPath}`,
    `Playback time: ${formatTime(currentTime)}`,
    `Source file: ${displayedSourceFile}`,
    `DOM id: ${selection.id ?? "(none)"}`,
    `Selector: ${selection.selector ?? "(none)"}`,
    `Selector index: ${selection.selectorIndex ?? 0}`,
    `Tag: <${selection.tagName}>`,
    `Bounds: ${formatBoundingBox(selection.boundingBox)}`,
  ];

  if (selection.textContent) {
    lines.push(`Text: ${selection.textContent}`);
  }

  const trimmedSelectionContext = selectionContext?.trim();
  if (trimmedSelectionContext) {
    lines.push("", "Selection context:", trimmedSelectionContext);
  }

  const textFieldsBlock = formatTextFields(selection.textFields);
  if (textFieldsBlock) {
    lines.push("", "Text fields:", textFieldsBlock);
  }

  const inlineStyleBlock = formatStyleBlock(selection.inlineStyles);
  if (inlineStyleBlock) {
    lines.push("", "Inline styles:", inlineStyleBlock);
  }

  const computedStyleBlock = formatStyleBlock(selection.computedStyles);
  if (computedStyleBlock) {
    lines.push("", "Computed styles (browser-resolved):", computedStyleBlock);
  }

  if (tagSnippet) {
    lines.push("", "Target HTML:", tagSnippet);
  }

  if (alsoSelected.length > 0) {
    lines.push(
      "",
      `Also selected (${alsoSelected.length} more element${alsoSelected.length > 1 ? "s" : ""}) — apply the same change to each:`,
      formatAlsoSelected(alsoSelected),
    );
  }

  lines.push(
    "",
    "Guardrails:",
    alsoSelected.length > 0
      ? "- Make the targeted change to every selected element, and nothing else."
      : "- Make a targeted change to this element only.",
    "- Preserve the rest of the composition and its timing.",
    "- Do not modify other elements' data-* attributes or positioning.",
    "- Prefer existing inline styles or existing CSS rules for this element over adding unrelated selectors.",
  );

  // OverlayState: the agent narrates its own work onto the canvas. Studio only
  // shows "working" on its own, so this is the only way the preview can say
  // anything finer — and an agent that ignores it still loses nothing.
  lines.push(
    "",
    "Overlay state (optional):",
    '- Print `<!-- hf:overlay {"kind":"editing","scope":"text","label":"Rewriting the headline"} -->` at any point and Studio shows it on this element in the preview.',
    "- kind: reading | thinking | editing. Without one, the element just says the run is working.",
    "- scope: text | box | motion | content — what the edit is about; it selects a finer treatment.",
    "- label: one short line for the badge. accent: any CSS colour, if this run wants its own.",
    "- target: {selector} or {id} to point the state at a different element than this one.",
    "- Do not declare done or failed: Studio sets those when the run exits.",
  );

  return lines.join("\n");
}
