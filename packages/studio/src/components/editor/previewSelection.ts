/**
 * Selections in a preview frame Studio cannot script, built from its runtime's element
 * descriptions. Which element a selection lands on comes from `domEditSelectionRules.ts`, the
 * rules a scriptable frame's selections use, so both kinds of frame select the same element.
 *
 * Such a selection's `element` is a stand-in: an element with only the target's tag, in a
 * document with no window, the same one for a handle for the whole frame load. Nothing in it
 * loads, runs or renders, and nothing from the frame is copied into it. The frame's element is
 * the selection's `handle`.
 */
import { resolveEditingAffordances } from "@hyperframes/core/editing";
import type { EditingPortClient } from "@hyperframes/core/runtime/editing-port";
import {
  previewComputedStyles,
  previewEditingClient,
  previewFrameOpaque,
} from "../../player/lib/previewChannel";
import {
  describePreviewElements,
  previewAncestors,
  previewElementSelectorIndex,
  previewElementSourceFile,
  queryPreviewElements,
  type PreviewElement,
} from "../../player/lib/previewElements";
import { coversCompositionRoot } from "./domEditingRootLayer";
import {
  buildElementLabel,
  getDataAttributes,
  getInlineStyles,
  isHtmlElement,
  resolveElementSourceFile,
} from "./domEditingDom";
import { findElementForSelection } from "./domEditingElement";
import { capabilityFacts, resolveDomEditSelection } from "./domEditingLayers";
import {
  chainLocked,
  selectionLookups,
  selectionTargetIndex,
  timelineElementLookup,
  type SelectionChainReader,
  type SelectionLookupTarget,
} from "./domEditSelectionRules";
import {
  CURATED_STYLE_PROPERTIES,
  type DomEditContextOptions,
  type DomEditSelection,
  type TimelineElementDomTarget,
  type TimelineElementDomTargetOptions,
} from "./domEditingTypes";
import { existsInSourceFile } from "./probeSourceElement";

let inertDocument: Document | undefined;
const inert = () => (inertDocument ??= document.implementation.createHTMLDocument(""));

function inertElement(tag: string): HTMLElement {
  try {
    return inert().createElement(tag);
  } catch {
    return inert().createElement("div");
  }
}

const standIns = new WeakMap<EditingPortClient, Map<string, HTMLElement>>();
const standInHandles = new WeakMap<Element, string>();

function standInFor(iframe: HTMLIFrameElement, element: PreviewElement): HTMLElement {
  const client = previewEditingClient(iframe);
  const byHandle = standIns.get(client) ?? new Map<string, HTMLElement>();
  standIns.set(client, byHandle);
  let standIn = byHandle.get(element.handle);
  if (!standIn) {
    standIn = inertElement(element.tag);
    byHandle.set(element.handle, standIn);
    standInHandles.set(standIn, element.handle);
  }
  return standIn;
}

/**
 * The description as an element of the inert document, discarded after the read, so the label,
 * data-attribute and inline-style helpers read it as they read a live element.
 */
function readable(element: PreviewElement): HTMLElement {
  const probe = inertElement(element.tag);
  for (const [name, value] of element.attributes) {
    if (name !== "id" && name !== "class" && !name.startsWith("data-")) continue;
    try {
      probe.setAttribute(name, value);
    } catch {
      // A name the parser took but setAttribute refuses; no helper reads such a name.
    }
  }
  for (const [name, value] of Object.entries(element.inlineStyles)) {
    probe.style.setProperty(name, value);
  }
  probe.textContent = element.text;
  return probe;
}

const attr = (element: PreviewElement, name: string) =>
  element.attributes.find(([key]) => key === name)?.[1] ?? null;

/** Undefined when the frame cannot answer; null when nothing matches. */
type Found = PreviewElement | null | undefined;

const validSelector = (selector: string) => {
  try {
    inert().querySelector(selector);
    return true;
  } catch {
    return false;
  }
};

/** `findElementForSelection` over the frame's runtime. */
export async function findPreviewElementForSelection(
  iframe: HTMLIFrameElement,
  selection: SelectionLookupTarget,
  activeCompositionPath: string | null,
): Promise<Found> {
  for (const { selector, index } of selectionLookups(selection)) {
    if (!validSelector(selector)) continue;
    const reply = await queryPreviewElements(iframe, selector);
    if (!reply) return undefined;
    const fromFile = reply.matches.filter(
      ({ source }) =>
        !selection.sourceFile ||
        resolveElementSourceFile(source, activeCompositionPath) === selection.sourceFile,
    );
    const match = fromFile[index];
    if (!match) {
      if (reply.truncated) return undefined;
      continue;
    }
    const [element] = (await describePreviewElements(iframe, [match.handle])) ?? [];
    return element ?? undefined;
  }
  return null;
}

/** `findElementForTimelineElement` over the frame's runtime. */
export async function findPreviewElementForTimelineElement(
  iframe: HTMLIFrameElement,
  element: TimelineElementDomTarget,
  options: TimelineElementDomTargetOptions,
): Promise<Found> {
  const { target, sourceFile, rootFallback } = timelineElementLookup(element, options);
  const path = options.activeCompositionPath;
  const found = target && (await findPreviewElementForSelection(iframe, target, path));
  if (found !== null) return found;
  if (!rootFallback) return null;
  const reply = await queryPreviewElements(iframe, "[data-composition-id]");
  if (!reply) return undefined;
  const root = reply.matches[0];
  if (!root || resolveElementSourceFile(root.source, path) !== sourceFile) return null;
  const [described] = (await describePreviewElements(iframe, [root.handle])) ?? [];
  return described ?? undefined;
}

/** The target and every ancestor up to the document element, or null when any is missing. */
async function previewChain(
  iframe: HTMLIFrameElement,
  target: PreviewElement,
): Promise<PreviewElement[] | null> {
  const [lineage] = (await previewAncestors(iframe, [target.handle])) ?? [];
  if (!lineage) return null;
  const ancestors = lineage.length ? await describePreviewElements(iframe, lineage) : [];
  if (!ancestors || ancestors.some((entry) => entry === null)) return null;
  const chain = [target, ...(ancestors as PreviewElement[])];
  const linked = chain.every((node, i) => node.parent === (chain[i + 1]?.handle ?? null));
  return linked ? chain : null;
}

function chainReader(chain: readonly PreviewElement[]): SelectionChainReader<PreviewElement> {
  const root = chain.at(-1);
  const body = chain.at(-2);
  return {
    attr,
    selector: (node) => node.selector ?? undefined,
    isDocumentRoot: (node) => node === root || (node === body && node.tag === "body"),
  };
}

async function compositionRoot(iframe: HTMLIFrameElement, documentElement: PreviewElement) {
  const reply = await queryPreviewElements(iframe, "[data-composition-id]");
  const first = reply?.matches[0];
  const [root] = first ? ((await describePreviewElements(iframe, [first.handle])) ?? []) : [];
  const element = root ?? documentElement;
  const { x, y, width, height } = element.rect;
  return {
    rect: { left: x, top: y, width, height },
    width: attr(element, "data-width"),
    height: attr(element, "data-height"),
  };
}

export type PreviewSelectionOptions = DomEditContextOptions & {
  projectId?: string | null;
  skipSourceProbe?: boolean;
  exactTarget?: boolean;
  previous?: DomEditSelection | null;
};

function chainIndex(
  chain: readonly PreviewElement[],
  read: SelectionChainReader<PreviewElement>,
  options: PreviewSelectionOptions,
): number | null {
  const active = options.activeGroupElement;
  const activeHandle = active ? standInHandles.get(active) : undefined;
  return selectionTargetIndex(chain, read, {
    exactTarget: options.exactTarget,
    preferClipAncestor: options.preferClipAncestor,
    activeGroupIndex: active ? chain.findIndex((node) => node.handle === activeHandle) : null,
  });
}

function previewIdentity(current: PreviewElement, path: string | null) {
  const selector = current.selector ?? undefined;
  return {
    id: current.id || undefined,
    hfId: attr(current, "data-hf-id")?.trim() || undefined,
    selector,
    selectorIndex: selector ? previewElementSelectorIndex(current, path) : undefined,
    sourceFile: previewElementSourceFile(current, path),
  };
}

async function isPreviewCompositionRoot(
  iframe: HTMLIFrameElement,
  chain: readonly PreviewElement[],
  index: number,
  computedStyles: Record<string, string>,
): Promise<boolean> {
  const current = chain[index]!;
  if (attr(current, "data-composition-id") !== null && !compositionSourceOf(current)) return true;
  const parent = chain[index + 1];
  const underBody = parent?.tag === "body" && chainReader(chain).isDocumentRoot(parent);
  if (!underBody || attr(current, "data-hf-allow-root-edit") !== null) return false;
  const { x, y, width, height } = current.rect;
  const rect = { left: x, top: y, width, height };
  return coversCompositionRoot(
    { rect, computedStyles },
    await compositionRoot(iframe, chain.at(-1)!),
  );
}

const compositionSourceOf = (element: PreviewElement) =>
  attr(element, "data-composition-src") ?? attr(element, "data-composition-file") ?? undefined;

/**
 * `resolveDomEditSelection` for a frame element Studio has a description of. Text fields are left
 * empty: they are read for text edits, which write through the frame's document.
 */
export async function resolvePreviewSelection(
  iframe: HTMLIFrameElement,
  target: PreviewElement,
  options: PreviewSelectionOptions,
): Promise<DomEditSelection | null> {
  const chain = await previewChain(iframe, target);
  const index = chain && chainIndex(chain, chainReader(chain), options);
  if (!chain || index === null) return null;
  const current = chain[index]!;
  const element = standInFor(iframe, current);
  const identity = previewIdentity(current, options.activeCompositionPath);
  const compositionSrc = compositionSourceOf(current);
  const probe = readable(current);
  const inlineStyles = getInlineStyles(probe);
  const computedStyles =
    (await previewComputedStyles(iframe, current, [...CURATED_STYLE_PROPERTIES])) ?? {};
  const isCompositionRoot = await isPreviewCompositionRoot(iframe, chain, index, computedStyles);
  const isInsideLocked = chainLocked(chain, chainReader(chain), index);
  const { sourceFile } = identity;
  const existsInSource = await existsInSourceFile(
    options.previous,
    element,
    sourceFile,
    identity,
    options,
  );
  const capabilities = resolveEditingAffordances(
    capabilityFacts({
      hasStableTarget: Boolean(identity.selector || identity.hfId),
      tag: current.tag,
      inlineStyles,
      computedStyles,
      isCompositionHost: Boolean(compositionSrc),
      isCompositionRoot,
      isInsideLockedComposition: isInsideLocked,
      isMasterView: options.isMasterView,
      existsInSource: existsInSource ?? true,
    }),
  ).capabilities;
  const { x, y, width, height } = current.rect;

  return {
    element,
    handle: current.handle,
    ...identity,
    compositionPath: sourceFile,
    compositionSrc,
    isCompositionHost: Boolean(compositionSrc),
    isInsideLockedComposition: isInsideLocked,
    label: buildElementLabel(probe),
    tagName: current.tag,
    boundingBox: { x, y, width, height },
    textContent: current.text.trim() || null,
    dataAttributes: getDataAttributes(probe),
    inlineStyles,
    computedStyles,
    textFields: [],
    capabilities,
    existsInSource,
  };
}

function liveElementForSelection(
  iframe: HTMLIFrameElement | null,
  selection: SelectionLookupTarget,
  activeCompositionPath: string | null,
): HTMLElement | null | undefined {
  let doc: Document | null = null;
  try {
    doc = iframe?.contentDocument ?? null;
  } catch {
    return undefined;
  }
  return doc ? findElementForSelection(doc, selection, activeCompositionPath) : undefined;
}

/** `selection`'s element in the frame now, or its description; undefined when the frame cannot answer. */
export async function findSelectionElement(
  iframe: HTMLIFrameElement | null,
  selection: SelectionLookupTarget,
  activeCompositionPath: string | null,
): Promise<HTMLElement | Found> {
  return iframe && previewFrameOpaque(iframe)
    ? findPreviewElementForSelection(iframe, selection, activeCompositionPath)
    : liveElementForSelection(iframe, selection, activeCompositionPath);
}

/** `resolveDomEditSelection` for an element, or for a description from `iframe`. */
export async function resolveFoundSelection(
  iframe: HTMLIFrameElement | null,
  found: HTMLElement | PreviewElement,
  options: PreviewSelectionOptions,
): Promise<DomEditSelection | null> {
  if (isHtmlElement(found)) return resolveDomEditSelection(found, options);
  return iframe ? resolvePreviewSelection(iframe, found, options) : null;
}

/** A timeline element's description in a frame Studio cannot script; null for any other frame. */
export async function findOpaqueTimelineElement(
  iframe: HTMLIFrameElement | null,
  element: TimelineElementDomTarget,
  lookup: TimelineElementDomTargetOptions,
): Promise<PreviewElement | null> {
  if (!iframe || !previewFrameOpaque(iframe)) return null;
  return (await findPreviewElementForTimelineElement(iframe, element, lookup)) ?? null;
}
