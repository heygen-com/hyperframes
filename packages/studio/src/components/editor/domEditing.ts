import { formatTime } from "../../player/lib/time";
import type { PatchOperation, PatchTarget } from "../../utils/sourcePatcher";

const CURATED_STYLE_PROPERTIES = [
  "position",
  "display",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "width",
  "height",
  "gap",
  "justify-content",
  "align-items",
  "flex-direction",
  "font-size",
  "font-weight",
  "font-family",
  "color",
  "background-color",
  "background-image",
  "opacity",
  "mix-blend-mode",
  "border-radius",
  "border-color",
  "outline-color",
  "overflow",
  "box-shadow",
  "z-index",
  "transform",
] as const;

export interface DomEditCapabilities {
  canSelect: boolean;
  canEditStyles: boolean;
  canMove: boolean;
  canResize: boolean;
  canDetachFromLayout: boolean;
  reasonIfDisabled?: string;
}

export interface DomEditTextField {
  key: string;
  label: string;
  value: string;
  tagName: string;
  attributes: Array<{ name: string; value: string }>;
  inlineStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  source: "self" | "child";
}

export interface DomEditSelection extends PatchTarget {
  element: HTMLElement;
  label: string;
  tagName: string;
  sourceFile: string;
  compositionPath: string;
  compositionSrc?: string;
  isCompositionHost: boolean;
  boundingBox: { x: number; y: number; width: number; height: number };
  textContent: string | null;
  dataAttributes: Record<string, string>;
  inlineStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  textFields: DomEditTextField[];
  capabilities: DomEditCapabilities;
}

export interface DomEditContextOptions {
  activeCompositionPath: string | null;
  isMasterView: boolean;
  preferClipAncestor?: boolean;
}

function isHtmlElement(value: unknown): value is HTMLElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    typeof (value as { nodeType?: unknown }).nodeType === "number" &&
    (value as { nodeType: number }).nodeType === 1
  );
}

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.endsWith("px")) return null;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isIdentityTransform(value: string | undefined): boolean {
  const transform = (value ?? "none").trim();
  if (!transform || transform === "none") return true;

  const matrix = transform.match(/^matrix\(([^)]+)\)$/i);
  if (matrix) {
    const values = matrix[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (values.length !== 6 || values.some((part) => !Number.isFinite(part))) return false;
    return (
      Math.abs(values[0] - 1) < 0.0001 &&
      Math.abs(values[1]) < 0.0001 &&
      Math.abs(values[2]) < 0.0001 &&
      Math.abs(values[3] - 1) < 0.0001 &&
      Math.abs(values[4]) < 0.0001 &&
      Math.abs(values[5]) < 0.0001
    );
  }

  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/i);
  if (!matrix3d) return false;
  const values = matrix3d[1].split(",").map((part) => Number.parseFloat(part.trim()));
  if (values.length !== 16 || values.some((part) => !Number.isFinite(part))) return false;
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return values.every((part, index) => Math.abs(part - identity[index]) < 0.0001);
}

function isClipClassName(className: string | undefined): boolean {
  return Boolean(className?.split(/\s+/).includes("clip"));
}

function isInlineTextTag(tagName: string | undefined): boolean {
  return Boolean(
    tagName &&
    ["a", "b", "em", "i", "small", "span", "strong", "sub", "sup"].includes(tagName.toLowerCase()),
  );
}

function isBlockishTag(tagName: string | undefined): boolean {
  return Boolean(
    tagName &&
    [
      "article",
      "aside",
      "canvas",
      "div",
      "figure",
      "footer",
      "header",
      "img",
      "main",
      "section",
      "svg",
      "video",
    ].includes(tagName.toLowerCase()),
  );
}

function isBlockishDisplay(display: string | undefined): boolean {
  return Boolean(
    display &&
    [
      "block",
      "flex",
      "flow-root",
      "grid",
      "inline-block",
      "inline-flex",
      "inline-grid",
      "list-item",
      "table",
    ].includes(display),
  );
}

function isTextBearingTag(tagName: string): boolean {
  return ["div", "span", "p", "strong", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName);
}

function getCuratedComputedStyles(el: HTMLElement): Record<string, string> {
  const styles: Record<string, string> = {};
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!computed) return styles;

  for (const prop of CURATED_STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(prop);
    if (value) styles[prop] = value;
  }

  return styles;
}

function findClosestByAttribute(el: HTMLElement, attributeNames: string[]): HTMLElement | null {
  let current: HTMLElement | null = el;
  while (current) {
    const candidate = current;
    if (attributeNames.some((attribute) => candidate.hasAttribute(attribute))) {
      return candidate;
    }
    current = current.parentElement;
  }
  return null;
}

function getCompositionHost(el: HTMLElement): HTMLElement | null {
  return findClosestByAttribute(el, ["data-composition-src", "data-composition-file"]);
}

function getSourceFileForElement(
  el: HTMLElement,
  activeCompositionPath: string | null,
): { sourceFile: string; compositionPath: string } {
  const ownerRoot = findClosestByAttribute(el, ["data-composition-id"]);
  const sourceFile =
    ownerRoot?.getAttribute("data-composition-file") ??
    ownerRoot?.getAttribute("data-composition-src") ??
    activeCompositionPath ??
    "index.html";

  return {
    sourceFile,
    compositionPath: sourceFile,
  };
}

function getSelectionCandidate(startEl: HTMLElement, options: DomEditContextOptions): HTMLElement {
  if (options.preferClipAncestor) {
    const clipAncestor = startEl.closest(".clip");
    if (isHtmlElement(clipAncestor)) {
      return clipAncestor;
    }
  }

  if (!options.isMasterView) return startEl;

  const compositionHost = getCompositionHost(startEl);
  if (compositionHost && compositionHost !== startEl) {
    return compositionHost;
  }

  return startEl;
}

function getPreferredClassSelector(el: HTMLElement): string | undefined {
  const classes = el.className
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (classes.length === 0) return undefined;
  const preferred =
    classes.find((value) => value !== "clip" && !value.startsWith("__hf-")) ?? classes[0];
  return preferred ? `.${preferred}` : undefined;
}

function humanizeIdentifier(value: string): string {
  return (
    value
      .replace(/\.html$/i, "")
      .replace(/^compositions\//i, "")
      .split("/")
      .at(-1)
      ?.replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase()) ?? value
  );
}

function buildStableSelector(el: HTMLElement): string | undefined {
  if (el.id) return `#${el.id}`;

  const compositionId = el.getAttribute("data-composition-id");
  if (compositionId) return `[data-composition-id="${compositionId}"]`;

  return getPreferredClassSelector(el);
}

function getSelectorIndex(
  doc: Document,
  el: HTMLElement,
  selector: string | undefined,
  sourceFile: string,
  activeCompositionPath: string | null,
): number | undefined {
  if (!selector?.startsWith(".")) return undefined;

  const candidates = Array.from(doc.querySelectorAll(selector)).filter(
    (candidate): candidate is HTMLElement =>
      isHtmlElement(candidate) &&
      getSourceFileForElement(candidate, activeCompositionPath).sourceFile === sourceFile,
  );
  const index = candidates.indexOf(el);
  return index >= 0 ? index : undefined;
}

function buildElementLabel(el: HTMLElement): string {
  const compositionId = el.getAttribute("data-composition-id");
  if (compositionId && compositionId !== "main") {
    return humanizeIdentifier(compositionId);
  }

  const compositionSrc =
    el.getAttribute("data-composition-src") ?? el.getAttribute("data-composition-file");
  if (compositionSrc) {
    return humanizeIdentifier(compositionSrc);
  }

  if (el.id) return humanizeIdentifier(el.id);

  const preferredClass = getPreferredClassSelector(el);
  if (preferredClass) {
    return humanizeIdentifier(preferredClass.replace(/^\./, ""));
  }

  const text = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  if (text) return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  return el.tagName.toLowerCase();
}

function getDataAttributes(el: HTMLElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    if (attr.name.startsWith("data-")) {
      attrs[attr.name.slice(5)] = attr.value;
    }
  }
  return attrs;
}

function getInlineStyles(el: HTMLElement): Record<string, string> {
  const styles: Record<string, string> = {};
  for (const property of CURATED_STYLE_PROPERTIES) {
    const value = el.style.getPropertyValue(property);
    if (value) styles[property] = value;
  }
  return styles;
}

function isEditableTextLeaf(el: HTMLElement): boolean {
  return isTextBearingTag(el.tagName.toLowerCase()) && el.children.length === 0;
}

function getTextFieldLabel(
  _tagName: string,
  index: number,
  total: number,
  source: "self" | "child",
): string {
  if (source === "self" || total === 1) return "Content";
  return `Text ${index + 1}`;
}

function buildTextField(
  el: HTMLElement,
  index: number,
  total: number,
  source: "self" | "child",
): DomEditTextField {
  const tagName = el.tagName.toLowerCase();
  const key = el.getAttribute("data-hf-text-key") ?? `${source}:${index}:${tagName}`;
  return {
    key,
    label: getTextFieldLabel(tagName, index, total, source),
    value: el.textContent ?? "",
    tagName,
    attributes: Array.from(el.attributes)
      .filter((attribute) => attribute.name !== "style")
      .map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
      })),
    inlineStyles: getInlineStyles(el),
    computedStyles: getCuratedComputedStyles(el),
    source,
  };
}

function collectDomEditTextFields(el: HTMLElement): DomEditTextField[] {
  const childFields = Array.from(el.children).filter(isHtmlElement).filter(isEditableTextLeaf);
  if (childFields.length > 0) {
    return childFields.map((child, index) =>
      buildTextField(child, index, childFields.length, "child"),
    );
  }

  if (isEditableTextLeaf(el)) {
    return [buildTextField(el, 0, 1, "self")];
  }

  return [];
}

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function serializeTextFieldStyle(field: DomEditTextField): string {
  const entries = Object.entries(field.inlineStyles).filter(([, value]) => Boolean(value));
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}: ${value}`).join("; ");
}

export function serializeDomEditTextFields(fields: DomEditTextField[]): string {
  return fields
    .filter((field) => field.source === "child")
    .map((field) => {
      const attrs = [
        ...field.attributes.filter((attribute) => attribute.name !== "data-hf-text-key"),
        { name: "data-hf-text-key", value: field.key },
      ]
        .map((attribute) => ` ${attribute.name}="${attribute.value.replace(/"/g, "&quot;")}"`)
        .join("");
      const style = serializeTextFieldStyle(field);
      const styleAttr = style ? ` style="${style.replace(/"/g, "&quot;")}"` : "";
      return `<${field.tagName}${attrs}${styleAttr}>${escapeHtmlText(field.value)}</${field.tagName}>`;
    })
    .join("");
}

export function buildDefaultDomEditTextField(base?: Partial<DomEditTextField>): DomEditTextField {
  return {
    key: `child:new:${Date.now()}`,
    label: "Text",
    value: "New text",
    tagName: "span",
    attributes: [],
    inlineStyles: {
      "font-family": base?.computedStyles?.["font-family"] ?? "inherit",
      "font-size": base?.computedStyles?.["font-size"] ?? "16px",
      "font-weight": base?.computedStyles?.["font-weight"] ?? "400",
      color: base?.computedStyles?.color ?? "inherit",
    },
    computedStyles: {},
    source: "child",
  };
}

export function resolveDomEditCapabilities(args: {
  selector?: string;
  tagName?: string;
  className?: string;
  inlineStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  isCompositionHost: boolean;
  isMasterView: boolean;
}): DomEditCapabilities {
  if (!args.selector) {
    return {
      canSelect: false,
      canEditStyles: false,
      canMove: false,
      canResize: false,
      canDetachFromLayout: false,
      reasonIfDisabled: "Studio could not resolve a stable patch target for this element.",
    };
  }

  const position = args.computedStyles.position;
  const left = parsePx(args.inlineStyles.left) ?? parsePx(args.computedStyles.left);
  const top = parsePx(args.inlineStyles.top) ?? parsePx(args.computedStyles.top);
  const width = parsePx(args.inlineStyles.width) ?? parsePx(args.computedStyles.width);
  const height = parsePx(args.inlineStyles.height) ?? parsePx(args.computedStyles.height);
  const hasTransformDrivenGeometry = !isIdentityTransform(args.computedStyles.transform);

  const canMove =
    (position === "absolute" || position === "fixed") &&
    left != null &&
    top != null &&
    !hasTransformDrivenGeometry;

  const canResize = canMove && (width != null || height != null);
  const isBlockishLayer =
    args.isCompositionHost ||
    isClipClassName(args.className) ||
    isBlockishTag(args.tagName) ||
    isBlockishDisplay(args.computedStyles.display);
  const canDetachFromLayout =
    !canMove &&
    !hasTransformDrivenGeometry &&
    isBlockishLayer &&
    (!isInlineTextTag(args.tagName) || isClipClassName(args.className));
  const reasonIfDisabled = !canMove
    ? canDetachFromLayout
      ? "This layer is controlled by layout."
      : "Direct move/resize is limited to absolute or fixed elements with px geometry and no transform-driven layout."
    : undefined;

  if (args.isCompositionHost && args.isMasterView) {
    return {
      canSelect: true,
      canEditStyles: false,
      canMove,
      canResize,
      canDetachFromLayout,
      reasonIfDisabled,
    };
  }

  return {
    canSelect: true,
    canEditStyles: true,
    canMove,
    canResize,
    canDetachFromLayout,
    reasonIfDisabled,
  };
}

export function resolveDomEditSelection(
  startEl: HTMLElement | null,
  options: DomEditContextOptions,
): DomEditSelection | null {
  if (!startEl) return null;
  const doc = startEl.ownerDocument;

  let current: HTMLElement | null = getSelectionCandidate(startEl, options);
  while (current && current !== doc.body && current !== doc.documentElement) {
    const selector = buildStableSelector(current);
    if (!selector) {
      current = current.parentElement;
      continue;
    }

    const { sourceFile, compositionPath } = getSourceFileForElement(
      current,
      options.activeCompositionPath,
    );
    const selectorIndex = getSelectorIndex(
      doc,
      current,
      selector,
      sourceFile,
      options.activeCompositionPath,
    );
    const compositionSrc =
      current.getAttribute("data-composition-src") ??
      current.getAttribute("data-composition-file") ??
      undefined;
    const inlineStyles = getInlineStyles(current);
    const computedStyles = getCuratedComputedStyles(current);
    const textFields = collectDomEditTextFields(current);
    const capabilities = resolveDomEditCapabilities({
      selector,
      tagName: current.tagName.toLowerCase(),
      className: current.className,
      inlineStyles,
      computedStyles,
      isCompositionHost: Boolean(compositionSrc),
      isMasterView: options.isMasterView,
    });
    const rect = current.getBoundingClientRect();

    return {
      element: current,
      id: current.id || undefined,
      selector,
      selectorIndex,
      sourceFile,
      compositionPath,
      compositionSrc,
      isCompositionHost: Boolean(compositionSrc),
      label: buildElementLabel(current),
      tagName: current.tagName.toLowerCase(),
      boundingBox: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      textContent: current.textContent?.trim() || null,
      dataAttributes: getDataAttributes(current),
      inlineStyles,
      computedStyles,
      textFields,
      capabilities,
    };
  }

  return null;
}

export function refreshDomEditSelection(
  selection: DomEditSelection,
  activeCompositionPath: string | null,
): DomEditSelection | null {
  const doc = selection.element.ownerDocument;
  const nextElement = findElementForSelection(doc, selection, activeCompositionPath);
  return nextElement
    ? resolveDomEditSelection(nextElement, {
        activeCompositionPath,
        isMasterView: !activeCompositionPath || activeCompositionPath === "index.html",
      })
    : null;
}

export function findElementForSelection(
  doc: Document,
  selection: Pick<DomEditSelection, "id" | "selector" | "selectorIndex" | "sourceFile">,
  activeCompositionPath: string | null = null,
): HTMLElement | null {
  if (selection.id) {
    const byId = doc.getElementById(selection.id);
    if (
      isHtmlElement(byId) &&
      (!selection.sourceFile ||
        getSourceFileForElement(byId, activeCompositionPath).sourceFile === selection.sourceFile)
    ) {
      return byId;
    }
  }

  if (!selection.selector) return null;

  if (selection.selector.startsWith(".") && selection.selectorIndex != null) {
    const matches = Array.from(doc.querySelectorAll(selection.selector)).filter(
      (candidate): candidate is HTMLElement =>
        isHtmlElement(candidate) &&
        (!selection.sourceFile ||
          getSourceFileForElement(candidate, activeCompositionPath).sourceFile ===
            selection.sourceFile),
    );
    return matches[selection.selectorIndex] ?? null;
  }

  const matches = Array.from(doc.querySelectorAll(selection.selector)).filter(
    (candidate): candidate is HTMLElement =>
      isHtmlElement(candidate) &&
      (!selection.sourceFile ||
        getSourceFileForElement(candidate, activeCompositionPath).sourceFile ===
          selection.sourceFile),
  );
  return matches[0] ?? null;
}

export function buildDomEditMovePatchOperations(left: number, top: number): PatchOperation[] {
  return [
    { type: "inline-style", property: "left", value: `${Math.round(left)}px` },
    { type: "inline-style", property: "top", value: `${Math.round(top)}px` },
  ];
}

export function buildDomEditResizePatchOperations(width: number, height: number): PatchOperation[] {
  return [
    { type: "inline-style", property: "width", value: `${Math.round(width)}px` },
    { type: "inline-style", property: "height", value: `${Math.round(height)}px` },
  ];
}

export function buildDomEditDetachPatchOperations(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): PatchOperation[] {
  return [
    { type: "inline-style", property: "position", value: "absolute" },
    { type: "inline-style", property: "left", value: `${Math.round(rect.left)}px` },
    { type: "inline-style", property: "top", value: `${Math.round(rect.top)}px` },
    { type: "inline-style", property: "width", value: `${Math.round(rect.width)}px` },
    { type: "inline-style", property: "height", value: `${Math.round(rect.height)}px` },
    { type: "inline-style", property: "margin", value: "0" },
    { type: "inline-style", property: "right", value: "auto" },
    { type: "inline-style", property: "bottom", value: "auto" },
  ];
}

export function buildDomEditStylePatchOperation(property: string, value: string): PatchOperation {
  return {
    type: "inline-style",
    property,
    value,
  };
}

export function buildDomEditTextPatchOperation(value: string): PatchOperation {
  return {
    type: "text-content",
    property: "text",
    value,
  };
}

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
        `- key=${field.key}; tag=<${field.tagName}>; source=${field.source}; text="${field.value.replace(/"/g, '\\"')}"`,
    )
    .join("\n");
}

export function buildElementAgentPrompt({
  selection,
  currentTime,
  tagSnippet,
  userInstruction,
  sourceFilePath,
}: {
  selection: DomEditSelection;
  currentTime: number;
  tagSnippet?: string;
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

export function isTextEditableSelection(selection: DomEditSelection): boolean {
  return selection.textFields.length > 0 && !selection.isCompositionHost;
}
