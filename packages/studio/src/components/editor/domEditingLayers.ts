/**
 * Layer items, text fields, capabilities, selection resolution, and patch operations
 * for dom editing.
 */
import type { PatchOperation } from "../../utils/sourcePatcher";
import type {
  DomEditCapabilities,
  DomEditContextOptions,
  DomEditLayerItem,
  DomEditSelection,
  DomEditTextField,
} from "./domEditingTypes";
import {
  buildStableSelector,
  findClosestByAttribute,
  getCuratedComputedStyles,
  getDataAttributes,
  getInlineStyles,
  getPreferredClassSelector,
  getSelectorIndex,
  getSourceFileForElement,
  humanizeIdentifier,
  isHtmlElement,
  isIdentityTransform,
  isTextBearingTag,
  parsePx,
} from "./domEditingDom";
import {
  findElementForSelection,
  getDomLayerPatchTarget,
  getDirectLayerChildren,
  getSelectionCandidate,
} from "./domEditingElement";

// ─── Text fields ────────────────────────────────────────────────────────────

export function isEditableTextLeaf(el: HTMLElement): boolean {
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

// fallow-ignore-next-line complexity
export function collectDomEditTextFields(el: HTMLElement): DomEditTextField[] {
  const childElements = Array.from(el.children).filter(isHtmlElement).filter(isEditableTextLeaf);

  if (childElements.length > 0) {
    const hasMixedContent = Array.from(el.childNodes).some(
      (node) => node.nodeType === 3 && node.textContent?.trim(),
    );

    if (hasMixedContent) {
      const fields: DomEditTextField[] = [];
      let childIdx = 0;
      for (const node of el.childNodes) {
        if (node.nodeType === 3) {
          const text = node.textContent ?? "";
          if (!text.trim()) continue;
          fields.push({
            key: `text-node:${childIdx}`,
            label: `Text ${childIdx + 1}`,
            value: text,
            tagName: "#text",
            attributes: [],
            inlineStyles: {},
            computedStyles: {},
            source: "text-node",
          });
          childIdx++;
        } else if (isHtmlElement(node) && isEditableTextLeaf(node)) {
          fields.push(buildTextField(node, childIdx, childElements.length, "child"));
          childIdx++;
        }
      }
      return fields;
    }

    return childElements.map((child, index) =>
      buildTextField(child, index, childElements.length, "child"),
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
    .filter((field) => field.source === "child" || field.source === "text-node")
    .map((field) => {
      if (field.source === "text-node") {
        return escapeHtmlText(field.value);
      }
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

// ─── Capabilities ────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function resolveDomEditCapabilities(args: {
  selector?: string;
  hfId?: string;
  tagName?: string;
  className?: string;
  inlineStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  isCompositionHost: boolean;
  isInsideLockedComposition: boolean;
  isMasterView: boolean;
  existsInSource?: boolean;
}): DomEditCapabilities {
  if ((!args.selector && !args.hfId) || args.isInsideLockedComposition) {
    return {
      canSelect: !args.isInsideLockedComposition,
      canEditStyles: false,
      canMove: false,
      canResize: false,
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
      reasonIfDisabled: args.isInsideLockedComposition
        ? "This element belongs to a locked composition."
        : "Studio could not resolve a stable patch target for this element.",
    };
  }

  if (args.existsInSource === false) {
    return {
      canSelect: true,
      canEditStyles: false,
      canMove: false,
      canResize: false,
      canApplyManualOffset: false,
      canApplyManualSize: false,
      canApplyManualRotation: false,
      reasonIfDisabled: "This element is generated by a script and cannot be edited visually.",
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
  const canApplyManualGeometry = !args.isCompositionHost;
  const canApplyManualOffset = canApplyManualGeometry;
  const canApplyManualSize = canApplyManualGeometry;
  const canApplyManualRotation = canApplyManualGeometry;
  const reasonIfDisabled = canApplyManualGeometry
    ? undefined
    : "Select an internal layer to transform it.";

  if (args.isCompositionHost && args.isMasterView) {
    return {
      canSelect: true,
      canEditStyles: false,
      canMove,
      canResize,
      canApplyManualOffset,
      canApplyManualSize,
      canApplyManualRotation,
      reasonIfDisabled,
    };
  }

  return {
    canSelect: true,
    canEditStyles: true,
    canMove,
    canResize,
    canApplyManualOffset,
    canApplyManualSize,
    canApplyManualRotation,
    reasonIfDisabled,
  };
}

// ─── Element label ────────────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export function buildElementLabel(el: HTMLElement): string {
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

// ─── Source probe ────────────────────────────────────────────────────────────

async function probeSourceElement(
  projectId: string,
  sourceFile: string,
  target: { id?: string; hfId?: string; selector?: string; selectorIndex?: number },
): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/projects/${projectId}/file-mutations/probe-element/${encodeURIComponent(sourceFile)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target }),
      },
    );
    if (!response.ok) return true;
    const data = (await response.json()) as { exists?: boolean };
    return data.exists !== false;
  } catch {
    return true;
  }
}

// ─── Selection resolution ────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
export async function resolveDomEditSelection(
  startEl: HTMLElement | null,
  options: DomEditContextOptions & { projectId?: string | null; skipSourceProbe?: boolean },
): Promise<DomEditSelection | null> {
  if (!startEl) return null;
  const doc = startEl.ownerDocument;

  let current: HTMLElement | null = getSelectionCandidate(startEl, options);
  while (current && current !== doc.body && current !== doc.documentElement) {
    const selector = buildStableSelector(current);
    const hfId = readHfId(current);
    if (!selector && !hfId) {
      current = current.parentElement;
      continue;
    }

    const { sourceFile, compositionPath } = getSourceFileForElement(
      current,
      options.activeCompositionPath,
    );
    const selectorIndex = selector
      ? getSelectorIndex(doc, current, selector, sourceFile, options.activeCompositionPath)
      : undefined;
    const compositionSrc =
      current.getAttribute("data-composition-src") ??
      current.getAttribute("data-composition-file") ??
      undefined;
    const inlineStyles = getInlineStyles(current);
    const computedStyles = getCuratedComputedStyles(current);
    const textFields = collectDomEditTextFields(current);
    const isInsideLocked = Boolean(findClosestByAttribute(current, ["data-timeline-locked"]));
    let existsInSource: boolean | undefined;
    if (!options.skipSourceProbe && options.projectId && (current.id || selector || hfId)) {
      const probeTarget: { id?: string; hfId?: string; selector?: string; selectorIndex?: number } =
        {};
      if (current.id) probeTarget.id = current.id;
      if (hfId) probeTarget.hfId = hfId;
      if (selector) probeTarget.selector = selector;
      if (selectorIndex != null) probeTarget.selectorIndex = selectorIndex;
      existsInSource = await probeSourceElement(options.projectId, sourceFile, probeTarget);
    }
    const capabilities = resolveDomEditCapabilities({
      selector,
      hfId,
      tagName: current.tagName.toLowerCase(),
      className: current.className,
      inlineStyles,
      computedStyles,
      isCompositionHost: Boolean(compositionSrc),
      isInsideLockedComposition: isInsideLocked,
      isMasterView: options.isMasterView,
      existsInSource,
    });
    const rect = current.getBoundingClientRect();

    return {
      element: current,
      id: current.id || undefined,
      hfId,
      selector,
      selectorIndex,
      sourceFile,
      compositionPath,
      compositionSrc,
      isCompositionHost: Boolean(compositionSrc),
      isInsideLockedComposition: isInsideLocked,
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

export async function refreshDomEditSelection(
  selection: DomEditSelection,
  activeCompositionPath: string | null,
): Promise<DomEditSelection | null> {
  const doc = selection.element.ownerDocument;
  const nextElement = findElementForSelection(doc, selection, activeCompositionPath);
  return nextElement
    ? resolveDomEditSelection(nextElement, {
        activeCompositionPath,
        isMasterView: !activeCompositionPath || activeCompositionPath === "index.html",
      })
    : null;
}

// ─── Layer items ─────────────────────────────────────────────────────────────

export function getDomEditLayerKey(
  target: Pick<DomEditSelection, "id" | "selector" | "selectorIndex" | "sourceFile">,
): string {
  const selectorIndex = target.selectorIndex ?? 0;
  return `${target.sourceFile}:${target.id ?? target.selector ?? "layer"}:${selectorIndex}`;
}

export function countDomEditChildLayers(
  root: HTMLElement | null | undefined,
  options: DomEditContextOptions,
  maxCount = 99,
): number {
  if (!root) return 0;

  let count = 0;
  const visit = (el: HTMLElement) => {
    for (const child of Array.from(el.children)) {
      if (!isHtmlElement(child)) continue;
      if (getDomLayerPatchTarget(child, options.activeCompositionPath)) {
        count += 1;
        if (count >= maxCount) return;
      }
      visit(child);
      if (count >= maxCount) return;
    }
  };

  visit(root);
  return count;
}

export function collectDomEditLayerItems(
  root: HTMLElement | null | undefined,
  options: DomEditContextOptions,
  maxItems = 80,
): DomEditLayerItem[] {
  if (!root) return [];

  const items: DomEditLayerItem[] = [];
  // fallow-ignore-next-line complexity
  const visit = (el: HTMLElement, depth: number) => {
    if (items.length >= maxItems) return;

    const target = getDomLayerPatchTarget(el, options.activeCompositionPath);
    if (target) {
      items.push({
        key: getDomEditLayerKey(target),
        element: el,
        label: buildElementLabel(el),
        tagName: el.tagName.toLowerCase(),
        depth,
        childCount: getDirectLayerChildren(el, options).length,
        id: target.id ?? undefined,
        hfId: target.hfId ?? undefined,
        selector: target.selector ?? undefined,
        selectorIndex: target.selectorIndex,
        sourceFile: target.sourceFile,
      });
    }

    const nextDepth = target ? depth + 1 : depth;
    for (const child of Array.from(el.children)) {
      if (!isHtmlElement(child)) continue;
      visit(child, nextDepth);
      if (items.length >= maxItems) return;
    }
  };

  visit(root, 0);
  return items;
}

// ─── Patch operations ────────────────────────────────────────────────────────

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

// ─── Non-editable reason ─────────────────────────────────────────────────────

function hasSupportedDirectEdit(capabilities: DomEditCapabilities): boolean {
  return (
    capabilities.canEditStyles ||
    capabilities.canMove ||
    capabilities.canResize ||
    capabilities.canApplyManualOffset ||
    capabilities.canApplyManualSize ||
    capabilities.canApplyManualRotation
  );
}

export function getDomEditNonEditableReason(
  element: HTMLElement,
  selection: DomEditSelection | null,
): string | null {
  if (!selection) {
    return "No stable source target";
  }

  if (selection.element !== element) {
    return selection.isCompositionHost
      ? "Nested composition boundary"
      : `Selection resolves to ${selection.label}`;
  }

  if (!hasSupportedDirectEdit(selection.capabilities)) {
    return selection.capabilities.reasonIfDisabled ?? "No supported direct edits";
  }

  return null;
}

export function getDomEditTargetKey(
  selection: Pick<DomEditSelection, "id" | "hfId" | "selector" | "selectorIndex" | "sourceFile">,
): string {
  return [
    selection.sourceFile || "index.html",
    selection.hfId ?? "",
    selection.id ?? "",
    selection.selector ?? "",
    selection.selectorIndex ?? "",
  ].join("|");
}

export function isTextEditableSelection(selection: DomEditSelection): boolean {
  return (
    selection.textFields.length > 0 &&
    !selection.isCompositionHost &&
    !selection.isInsideLockedComposition
  );
}

// buildElementAgentPrompt is in domEditingAgentPrompt.ts

export function readHfId(element: Element): string | undefined {
  return element.getAttribute("data-hf-id")?.trim() || undefined;
}

export function buildDomEditPatchTarget(
  selection: Pick<DomEditSelection, "id" | "hfId" | "selector" | "selectorIndex">,
): { id?: string | null; hfId?: string; selector?: string; selectorIndex?: number } {
  return {
    id: selection.id,
    hfId: selection.hfId,
    selector: selection.selector,
    selectorIndex: selection.selectorIndex,
  };
}
