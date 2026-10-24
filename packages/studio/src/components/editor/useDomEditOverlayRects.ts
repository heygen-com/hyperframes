/**
 * RAF-driven hook that tracks overlay, hover, and group rects from the iframe DOM.
 * Runs a requestAnimationFrame loop and writes React state only when rects change.
 */
import { useRef, useState, type RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { hugRectForElement } from "./domEditOverlayCrop";
import { type DomEditSelection, findElementForSelection } from "./domEditing";
import {
  type GroupOverlayItem,
  type OverlayRect,
  type ResolvedElementRef,
  groupOverlayItemsEqual,
  isElementVisibleForOverlay,
  groupAwareOverlayRect,
  orientedGroupAwareOverlayRect,
  rectsEqual,
  resolveElementForOverlay,
  selectionCacheKey,
  orientedVisibleOverlayRect,
} from "./domEditOverlayGeometry";
import { computeOverlayRootScale } from "./domEditOverlayBasis";
import { subscribeOverlayFrame } from "./overlayFrameLoop";

function childRectsEqual(a: OverlayRect[], b: OverlayRect[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!rectsEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

interface UseDomEditOverlayRectsOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  overlayRef: RefObject<HTMLDivElement | null>;
  selectionRef: RefObject<DomEditSelection | null>;
  activeCompositionPathRef: RefObject<string | null>;
  groupSelectionsRef: RefObject<DomEditSelection[]>;
  hoverSelectionRef: RefObject<DomEditSelection | null>;
  rafPausedRef: RefObject<boolean>;
}

interface UseDomEditOverlayRectsResult {
  overlayRect: OverlayRect | null;
  overlayRectRef: RefObject<OverlayRect | null>;
  setOverlayRect: (next: OverlayRect | null) => void;
  hoverRect: OverlayRect | null;
  hoverRectRef: RefObject<OverlayRect | null>;
  setHoverRect: (next: OverlayRect | null) => void;
  groupOverlayItems: GroupOverlayItem[];
  groupOverlayItemsRef: RefObject<GroupOverlayItem[]>;
  setGroupOverlayItems: (next: GroupOverlayItem[]) => void;
  childRects: OverlayRect[];
}

function lazyOverlayRootScale(
  overlayEl: HTMLDivElement,
  iframe: HTMLIFrameElement,
  doc: Document,
): () => ReturnType<typeof computeOverlayRootScale> {
  let read: { value: ReturnType<typeof computeOverlayRootScale> } | undefined;
  return () => (read ??= { value: computeOverlayRootScale(overlayEl, iframe, doc) }).value;
}

interface OverlayFrame {
  doc: Document;
  iframe: HTMLIFrameElement;
  overlayEl: HTMLDivElement;
  scale: () => ReturnType<typeof computeOverlayRootScale>;
}

function hoverHasItsOwnBox(
  hoverSel: DomEditSelection,
  sel: DomEditSelection | null,
  group: DomEditSelection[],
): boolean {
  const hoverKey = selectionCacheKey(hoverSel);
  if (sel && selectionCacheKey(sel) === hoverKey) return true;
  return group.some((entry) => selectionCacheKey(entry) === hoverKey);
}

export function useDomEditOverlayRects({
  iframeRef,
  overlayRef,
  selectionRef,
  activeCompositionPathRef,
  groupSelectionsRef,
  hoverSelectionRef,
  rafPausedRef,
}: UseDomEditOverlayRectsOptions): UseDomEditOverlayRectsResult {
  const [overlayRect, setOverlayRectState] = useState<OverlayRect | null>(null);
  const [hoverRect, setHoverRectState] = useState<OverlayRect | null>(null);
  const [groupOverlayItems, setGroupOverlayItemsState] = useState<GroupOverlayItem[]>([]);
  const [childRects, setChildRectsState] = useState<OverlayRect[]>([]);

  const overlayRectRef = useRef<OverlayRect | null>(null);
  const hoverRectRef = useRef<OverlayRect | null>(null);
  const groupOverlayItemsRef = useRef<GroupOverlayItem[]>([]);
  const resolvedElementRef = useRef<{ key: string; element: HTMLElement } | null>(null);
  const resolvedHoverElementRef = useRef<{ key: string; element: HTMLElement } | null>(null);
  const resolvedGroupElementRef = useRef<Map<string, HTMLElement>>(new Map());
  const childRectsRef = useRef<OverlayRect[]>([]);

  const setOverlayRect = (next: OverlayRect | null) => {
    if (rectsEqual(overlayRectRef.current, next)) return;
    overlayRectRef.current = next;
    setOverlayRectState(next);
  };

  const setHoverRect = (next: OverlayRect | null) => {
    if (rectsEqual(hoverRectRef.current, next)) return;
    hoverRectRef.current = next;
    setHoverRectState(next);
  };

  const setGroupOverlayItems = (next: GroupOverlayItem[]) => {
    if (groupOverlayItemsEqual(groupOverlayItemsRef.current, next)) return;
    groupOverlayItemsRef.current = next;
    setGroupOverlayItemsState(next);
  };

  const resolveGroupElement = (doc: Document, sel: DomEditSelection) => {
    const key = selectionCacheKey(sel);
    const cached = resolvedGroupElementRef.current.get(key);
    if (cached?.isConnected && cached.ownerDocument === doc) return cached;

    const next = findElementForSelection(doc, sel, activeCompositionPathRef.current);
    if (next) {
      resolvedGroupElementRef.current.set(key, next);
    } else {
      resolvedGroupElementRef.current.delete(key);
    }
    return next;
  };

  useMountEffect(() => {
    const clearAll = () => {
      setOverlayRect(null);
      setHoverRect(null);
      setGroupOverlayItems([]);
    };

    const forgetResolvedElements = () => {
      resolvedElementRef.current = null;
      resolvedHoverElementRef.current = null;
      resolvedGroupElementRef.current.clear();
    };

    const clearChildRects = () => {
      if (childRectsRef.current.length === 0) return;
      childRectsRef.current = [];
      setChildRectsState([]);
    };

    const syncChildRects = (frame: OverlayFrame, el: HTMLElement) => {
      const descendants = el.querySelectorAll("*");
      if (descendants.length === 0 || descendants.length > 60) {
        clearChildRects();
        return;
      }
      const nextChildRects: OverlayRect[] = [];
      for (let i = 0; i < descendants.length; i++) {
        const child = descendants[i] as HTMLElement;
        if (!child.getBoundingClientRect) continue;
        // Oriented, not axis-aligned: a child of a rotated element drew its
        // outline square around the rotated glyphs instead of on them.
        const r = orientedVisibleOverlayRect(frame.overlayEl, frame.iframe, child, frame.scale());
        if (r && r.width > 2 && r.height > 2) nextChildRects.push(r);
      }
      if (!childRectsEqual(childRectsRef.current, nextChildRects)) {
        childRectsRef.current = nextChildRects;
        setChildRectsState(nextChildRects);
      }
    };

    const syncSelectionRect = (frame: OverlayFrame, sel: DomEditSelection | null) => {
      if (!sel) {
        resolvedElementRef.current = null;
        setOverlayRect(null);
        clearChildRects();
        return;
      }
      const el = resolveElementForOverlay(
        frame.doc,
        sel,
        activeCompositionPathRef.current,
        resolvedElementRef as ResolvedElementRef,
      );
      // An explicitly-selected element's overlay must track it whenever it's laid
      // out and not display:none/visibility:hidden/opacity:0 — use basic visibility,
      // NOT the occlusion heuristic. Occlusion (isElementVisibleInPreview) treats any
      // opacity:1 ancestor as an opaque cover even when it paints nothing (e.g. a
      // backgroundless full-bleed scene above a subcomposition), which would wrongly
      // hide the selection box. Occlusion stays for hover, where a false hide is cheap.
      if (!el || !isElementVisibleForOverlay(el)) {
        setOverlayRect(null);
        clearChildRects();
        return;
      }
      // Groups render as an AABB union of their members (a group OBB is out of
      // scope); a single element renders as an oriented box that co-rotates
      // with its transform. orientedOverlayRect gates on rotation internally
      // (a cheap per-call check) and only pays for the full corner-transform
      // measurement when the element is actually rotated — this RAF loop runs
      // every frame for any single selection, so that gate matters here most.
      setOverlayRect(
        orientedGroupAwareOverlayRect(frame.overlayEl, frame.iframe, el, frame.scale()),
      );
      syncChildRects(frame, el);
    };

    const groupOverlayItem = (
      frame: OverlayFrame,
      key: string,
      selection: DomEditSelection,
    ): GroupOverlayItem | null => {
      const element = resolveGroupElement(frame.doc, selection);
      if (!element) return null;
      const base = groupAwareOverlayRect(frame.overlayEl, frame.iframe, element, frame.scale());
      if (!base) return null;
      return { key, selection, element, rect: { ...base, ...hugRectForElement(base, element) } };
    };

    const syncGroupItems = (frame: OverlayFrame, group: DomEditSelection[]) => {
      if (group.length === 0) {
        resolvedGroupElementRef.current.clear();
        setGroupOverlayItems([]);
        return;
      }
      const nextGroupItems: GroupOverlayItem[] = [];
      const liveGroupKeys = new Set<string>();
      for (const groupSelection of group) {
        const key = selectionCacheKey(groupSelection);
        // Members of the same group collapse to one selection under select-as-unit,
        // so a multi-select can hold the same group twice — dedupe by key to avoid
        // duplicate React keys (and a doubled overlay box).
        if (liveGroupKeys.has(key)) continue;
        liveGroupKeys.add(key);
        const item = groupOverlayItem(frame, key, groupSelection);
        if (item) nextGroupItems.push(item);
      }
      for (const key of resolvedGroupElementRef.current.keys()) {
        if (!liveGroupKeys.has(key)) resolvedGroupElementRef.current.delete(key);
      }
      setGroupOverlayItems(nextGroupItems);
    };

    const syncHoverRect = (
      frame: OverlayFrame,
      sel: DomEditSelection | null,
      group: DomEditSelection[],
    ) => {
      const hoverSel = hoverSelectionRef.current;
      if (!hoverSel || hoverHasItsOwnBox(hoverSel, sel, group)) {
        resolvedHoverElementRef.current = null;
        setHoverRect(null);
        return;
      }
      const hoverEl = resolveElementForOverlay(
        frame.doc,
        hoverSel,
        activeCompositionPathRef.current,
        resolvedHoverElementRef as ResolvedElementRef,
      );
      setHoverRect(
        hoverEl
          ? orientedGroupAwareOverlayRect(frame.overlayEl, frame.iframe, hoverEl, frame.scale())
          : null,
      );
    };

    const update = () => {
      if (rafPausedRef.current) {
        clearChildRects();
        return;
      }
      const sel = selectionRef.current;
      const iframe = iframeRef.current;
      const overlayEl = overlayRef.current;
      const doc = iframe && overlayEl ? iframe.contentDocument : null;
      if (!iframe || !overlayEl || !doc) {
        forgetResolvedElements();
        clearAll();
        return;
      }
      // One basis for the whole frame: the selection box, up to 60 child
      // outlines, every group box and the hover box all map through the same
      // iframe→overlay transform, read at most once per frame, and nothing
      // below writes to the preview DOM or moves the canvas.
      const frame: OverlayFrame = {
        doc,
        iframe,
        overlayEl,
        scale: lazyOverlayRootScale(overlayEl, iframe, doc),
      };
      const group = groupSelectionsRef.current;
      syncSelectionRect(frame, sel);
      syncGroupItems(frame, group);
      syncHoverRect(frame, sel, group);
    };

    return subscribeOverlayFrame(update);
  });

  return {
    overlayRect,
    overlayRectRef,
    setOverlayRect,
    hoverRect,
    hoverRectRef,
    setHoverRect,
    groupOverlayItems,
    groupOverlayItemsRef,
    setGroupOverlayItems,
    childRects,
  };
}
