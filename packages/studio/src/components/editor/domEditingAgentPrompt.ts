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

export function buildElementAgentPrompt({
  selection,
  currentTime,
  tagSnippet,
  selectionContext,
  userInstruction,
  sourceFilePath,
}: {
  selection: DomEditSelection;
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

  lines.push(
    "",
    "Guardrails:",
    "- Make a targeted change to this element only.",
    "- Preserve the rest of the composition and its timing.",
    "- Do not modify other elements' data-* attributes or positioning.",
    "- Prefer existing inline styles or existing CSS rules for this element over adding unrelated selectors.",
  );

  return lines.join("\n");
}

export function buildAgentContextPreview(
  selection: DomEditSelection,
  activeCompPath: string | null,
): string {
  return [
    `Composition: ${selection.compositionPath}`,
    `Source: ${selection.sourceFile || activeCompPath || "index.html"}`,
    `Selector: ${selection.selector ?? "(none)"}  Tag: <${selection.tagName}>`,
    selection.textContent ? `Text: ${selection.textContent}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
