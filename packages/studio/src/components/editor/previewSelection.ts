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
import {
  MAX_ELEMENT_ENTRIES,
  MAX_ELEMENT_VALUE,
  type EditingPortClient,
} from "@hyperframes/core/runtime/editing-port";
import {
  previewComputedStyles,
  previewEditingClient,
  previewFrameOpaque,
} from "../../player/lib/previewChannel";
import {
  describePreviewElements,
  previewAncestors,
  previewElementSelectorIndex,
  previewPointerTargets,
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
import {
  framePointFraction,
  getAllPreviewTargetsFromPointer,
  getPreviewTargetFromPointer,
} from "../../utils/studioPreviewHelpers";
import { isVideoAudible } from "../../player/lib/timelineElementHelpers";

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
const standInAncestors = new WeakMap<Element, string[]>();

export function standInFor(iframe: HTMLIFrameElement, element: PreviewElement): HTMLElement {
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
export function readable(element: PreviewElement): HTMLElement {
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

const mayBeCut = (value: string) =>
  value.length >= MAX_ELEMENT_VALUE || (value.startsWith("data:") && value.endsWith(","));

/** A cut attribute or style (a long `data-audio-fx`, say) would be written back cut; text is not read back. */
function valuesWhole(element: PreviewElement): boolean {
  if (!element.truncated) return true;
  const styles = Object.values(element.inlineStyles);
  if (element.attributes.length >= MAX_ELEMENT_ENTRIES || styles.length >= MAX_ELEMENT_ENTRIES)
    return false;
  return ![...element.attributes.map(([, value]) => value), ...styles].some(mayBeCut);
}

const hasAudio = (element: PreviewElement) =>
  element.tag === "video" &&
  attr(element, "muted") === null &&
  isVideoAudible({ tag: "video", hasAudioAttr: attr(element, "data-has-audio"), muted: false });

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

/** A clip built without the frame's document has only the runtime's clip id: an id, else a hf-id. */
async function findByClipId(
  iframe: HTMLIFrameElement,
  element: TimelineElementDomTarget,
  sourceFile: string,
  path: string | null,
): Promise<Found> {
  if (!element.id || element.domId || element.selector || element.compositionSrc) return null;
  const byId = await findPreviewElementForSelection(iframe, { id: element.id, sourceFile }, path);
  if (byId !== null) return byId;
  return findPreviewElementForSelection(iframe, { hfId: element.id, sourceFile }, path);
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
  const byClipId = await findByClipId(iframe, element, sourceFile, path);
  if (byClipId !== null) return byClipId;
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
  if (!reply) return null;
  const first = reply.matches[0];
  const [root] = first ? ((await describePreviewElements(iframe, [first.handle])) ?? [null]) : [];
  if (root === null) return null;
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

export function previewIdentity(current: PreviewElement, path: string | null) {
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
): Promise<boolean | null> {
  const current = chain[index]!;
  if (attr(current, "data-composition-id") !== null && !compositionSourceOf(current)) return true;
  const parent = chain[index + 1];
  const underBody = parent?.tag === "body" && chainReader(chain).isDocumentRoot(parent);
  if (!underBody || attr(current, "data-hf-allow-root-edit") !== null) return false;
  const { x, y, width, height } = current.rect;
  const rect = { left: x, top: y, width, height };
  const root = await compositionRoot(iframe, chain.at(-1)!);
  return root && coversCompositionRoot({ rect, computedStyles }, root);
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
  if (!valuesWhole(current)) return null;
  const element = standInFor(iframe, current);
  standInAncestors.set(
    element,
    chain.slice(index + 1).map((node) => node.handle),
  );
  const identity = previewIdentity(current, options.activeCompositionPath);
  const compositionSrc = compositionSourceOf(current);
  const probe = readable(current);
  const inlineStyles = getInlineStyles(probe);
  const computedStyles = await previewComputedStyles(iframe, current, [
    ...CURATED_STYLE_PROPERTIES,
  ]);
  if (!computedStyles) return null;
  const isCompositionRoot = await isPreviewCompositionRoot(iframe, chain, index, computedStyles);
  if (isCompositionRoot === null) return null;
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
    hasAudio: hasAudio(current),
    src: attr(current, "src"),
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

export const standInHandle = (element: Element) => standInHandles.get(element);

export function elementWithin(container: HTMLElement, element: HTMLElement): boolean {
  const handle = standInHandles.get(container);
  if (handle === undefined) return container.contains(element);
  return element === container || (standInAncestors.get(element)?.includes(handle) ?? false);
}

/** A `data-` attribute of the selection's element; a stand-in's comes from its description. */
export function selectionDataAttribute(selection: DomEditSelection, name: `data-${string}`) {
  if (!selection.handle) return selection.element.getAttribute(name);
  return selection.dataAttributes[name.slice("data-".length)] ?? null;
}

const pointerAnswers = new WeakMap<HTMLIFrameElement, { x: number; y: number; found: boolean }>();

async function previewPointerTarget(iframe: HTMLIFrameElement, clientX: number, clientY: number) {
  const { x, y } = framePointFraction(iframe, clientX, clientY);
  const reply = await previewPointerTargets(iframe, x, y);
  if (reply) pointerAnswers.set(iframe, { x: clientX, y: clientY, found: reply.target !== null });
  return reply;
}

/** An opaque frame answers from its last pointer read at this point, and assumes a hit without one. */
export function pointerMayHitElement(iframe: HTMLIFrameElement, clientX: number, clientY: number) {
  if (!previewFrameOpaque(iframe))
    return Boolean(getPreviewTargetFromPointer(iframe, clientX, clientY));
  const answer = pointerAnswers.get(iframe);
  const near = answer && Math.hypot(answer.x - clientX, answer.y - clientY) <= 2;
  return near ? answer.found : true;
}

export async function findPointerTarget(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): Promise<HTMLElement | Found> {
  if (!previewFrameOpaque(iframe)) return getPreviewTargetFromPointer(iframe, clientX, clientY);
  const reply = await previewPointerTarget(iframe, clientX, clientY);
  if (!reply?.target) return reply ? null : undefined;
  const [described] = (await describePreviewElements(iframe, [reply.target.handle])) ?? [];
  return described ?? undefined;
}

export async function findPointerTargets(
  iframe: HTMLIFrameElement,
  clientX: number,
  clientY: number,
): Promise<Array<HTMLElement | PreviewElement>> {
  if (!previewFrameOpaque(iframe)) return getAllPreviewTargetsFromPointer(iframe, clientX, clientY);
  const reply = await previewPointerTarget(iframe, clientX, clientY);
  const handles = reply?.stack.map((hit) => hit.handle) ?? [];
  const described = handles.length ? await describePreviewElements(iframe, handles) : [];
  return (described ?? []).filter((element) => element !== null);
}

/** A stand-in is never connected: an opaque frame's selection stands until it is replaced. */
export const selectionElementLive = (selection: DomEditSelection) =>
  selection.handle !== undefined || selection.element.isConnected;
