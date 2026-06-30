/**
 * Layer items, text fields, capabilities, selection resolution, and patch operations
 * for dom editing.
 */
import type { PatchOperation } from "../../utils/sourcePatcher";
import {
  resolveEditingAffordances,
  resolveEditingSections,
  type EditableElementFacts,
} from "@hyperframes/core/editing";
import { groupScopedLayerRoots, resolveGroupCapture } from "./domEditingGroups";
import type {
  DomEditCapabilities,
  DomEditContextOptions,
  DomEditLayerItem,
  DomEditSelection,
  DomEditTextField,
} from "./domEditingTypes";
import {
  buildElementLabel,
  buildStableSelector,
  findClosestByAttribute,
  getCuratedComputedStyles,
  getDataAttributes,
  getInlineStyles,
  getSelectorIndex,
  getSourceFileForElement,
  isHtmlElement,
  isTextBearingTag,
} from "./domEditingDom";
import {
  findElementForSelection,
  getDomLayerPatchTarget,
  getDirectLayerChildren,
  getSelectionCandidate,
} from "./domEditingElement";
import { isCompositionRootLayer } from "./domEditingRootLayer";

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

/**
 * Build the geometry/capability half of EditableElementFacts. Section inputs
 * (text/timing/animation) are irrelevant to capability resolution, so they are
 * zeroed here. Shared by the wrapper and the live-selection path so the two
 * fact-construction sites can't disagree.
 */
function capabilityFacts(geometry: {
  hasStableTarget: boolean;
  tag: string;
  inlineStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  isCompositionHost: boolean;
  isCompositionRoot: boolean;
  isInsideLockedComposition: boolean;
  isMasterView: boolean;
  existsInSource: boolean;
}): EditableElementFacts {
  return {
    ...geometry,
    hasEditableText: false,
    hasTimingStart: false,
    animationCount: 0,
  };
}

/**
 * Build core EditableElementFacts from a fully-resolved DomEditSelection.
 * `animationCount` is supplied by the caller because live GSAP tweens arrive on
 * a separate channel (the PropertyPanel `gsapAnimations` prop), not on the
 * selection — `selection.gsapAnimations` is never populated.
 */
export function domEditSelectionToFacts(
  selection: DomEditSelection,
  animationCount = selection.gsapAnimations?.length ?? 0,
): EditableElementFacts {
  return {
    hasStableTarget: Boolean(selection.selector || selection.hfId),
    tag: selection.tagName,
    inlineStyles: selection.inlineStyles,
    computedStyles: selection.computedStyles,
    isCompositionHost: selection.isCompositionHost,
    isCompositionRoot: false,
    isInsideLockedComposition: selection.isInsideLockedComposition,
    isMasterView: false,
    existsInSource: true,
    hasEditableText: selection.textFields.length > 0,
    hasTimingStart: selection.dataAttributes.start != null,
    animationCount,
  };
}

/**
 * Resolve DOM edit capabilities for a given element.
 * Thin wrapper over core resolveEditingAffordances — kept for backward
 * compatibility (tests and the barrel import this signature directly).
 */
export function resolveDomEditCapabilities(args: {
  selector?: string;
  hfId?: string;
  tagName?: string;
  inlineStyles: Record<string, string>;
  computedStyles: Record<string, string>;
  isCompositionHost: boolean;
  isCompositionRoot?: boolean;
  isInsideLockedComposition: boolean;
  isMasterView: boolean;
  existsInSource?: boolean;
}): DomEditCapabilities {
  return resolveEditingAffordances(
    capabilityFacts({
      hasStableTarget: Boolean(args.selector || args.hfId),
      tag: (args.tagName ?? "div").toLowerCase(),
      inlineStyles: args.inlineStyles,
      computedStyles: args.computedStyles,
      isCompositionHost: args.isCompositionHost,
      isCompositionRoot: args.isCompositionRoot ?? false,
      isInsideLockedComposition: args.isInsideLockedComposition ?? false,
      isMasterView: args.isMasterView,
      existsInSource: args.existsInSource ?? true,
    }),
  ).capabilities;
}

// ─── Element label ────────────────────────────────────────────────────────────

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

  let capture = resolveGroupCapture(startEl, options.activeGroupElement ?? null);
  if (capture.kind === "out-of-scope") {
    // Drill-in is non-sticky: clicking/hovering OUTSIDE the drilled-into group
    // exits it and resolves the target normally, rather than selecting nothing
    // (which felt like "can't select anything" once you'd drilled in).
    capture = resolveGroupCapture(startEl, null);
  }
  let current: HTMLElement | null =
    capture.kind === "unit" ? capture.element : getSelectionCandidate(startEl, options);
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
    const isCompositionRoot =
      (current.hasAttribute("data-composition-id") && !compositionSrc) ||
      isCompositionRootLayer(current, doc, computedStyles);
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
    const capabilities = resolveEditingAffordances(
      capabilityFacts({
        hasStableTarget: Boolean(selector || hfId),
        tag: current.tagName.toLowerCase(),
        inlineStyles,
        computedStyles,
        isCompositionHost: Boolean(compositionSrc),
        isCompositionRoot,
        isInsideLockedComposition: isInsideLocked,
        isMasterView: options.isMasterView,
        existsInSource: existsInSource ?? true,
      }),
    ).capabilities;
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

  // Drilled into a group → show only its members; otherwise the whole tree.
  for (const el of groupScopedLayerRoots(root, options.activeGroupElement ?? null)) visit(el, 0);
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
  return resolveEditingSections(domEditSelectionToFacts(selection)).text;
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
