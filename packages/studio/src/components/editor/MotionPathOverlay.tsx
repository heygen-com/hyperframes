import { memo, useEffect, useRef, useState, type RefObject } from "react";
import type { DomEditSelection } from "./domEditing";
import { useDomEditContext } from "../../contexts/DomEditContext";
import { usePlayerStore } from "../../player/store/playerStore";
import { readRuntimeKeyframes } from "../../hooks/gsapRuntimeKeyframes";
import { parkPlayheadOnKeyframe } from "../../hooks/gsapDragCommit";
import { isElementVisibleForOverlay } from "./domEditOverlayGeometry";
import {
  buildMotionPathGeometry,
  nearestPointOnPath,
  type MotionNodeRef,
  type MotionPathGeometry,
} from "./motionPathGeometry";
import { editableAnimationId, selectorFor } from "./motionPathSelection";
import { ACCENT, MotionPathNode } from "./MotionPathNode";
import {
  KeyframeDiamondContextMenu,
  type KeyframeDiamondContextMenuState,
} from "../../player/components/KeyframeDiamondContextMenu";
import {
  commitAddKeyframe,
  commitAddWaypoint,
  commitCreatePath,
  commitNode,
  commitRemoveWaypoint,
} from "./motionPathCommit";

interface MotionPathOverlayProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selection: DomEditSelection | null;
  compositionSize: { width: number; height: number } | null;
  isPlaying: boolean;
}

type Rect = { left: number; top: number; width: number; height: number };
type Draft = { index: number; x: number; y: number };
type DragState = {
  index: number;
  startX: number;
  startY: number;
  initX: number;
  initY: number;
  scale: number;
  ref: MotionNodeRef;
};

const NODE_PX = 6; // node radius in screen pixels (kept constant across zoom)
// Click-vs-drag cutoff in SCREEN pixels. Below this the pointer-up is a click
// (select the keyframe); at or above it the gesture commits a move. Screen-space
// (not composition px) so it behaves identically at any zoom.
const DRAG_THRESHOLD_PX = 3;

/** The element's layout-home center in composition coordinates. GSAP x/y (and
 *  motionPath coords) are offsets from this point, so the overlay adds it to
 *  each node to place the path on the element rather than the canvas origin.
 *  offsetLeft/Top are transform-excluded, so home is stable across the
 *  animation; walk up to (not including) the composition root. */
function elementHome(el: HTMLElement): { x: number; y: number } {
  let left = 0;
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    left += node.offsetLeft;
    top += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (!parent || parent.hasAttribute("data-composition-id")) break;
    node = parent;
  }
  let x = left + el.offsetWidth / 2;
  let y = top + el.offsetHeight / 2;
  // Include the manual CSS path offset (`--hf-studio-offset`, applied via
  // `translate`). offsetLeft excludes transforms, but this offset is a stable
  // nudge (not animated) that shifts where the element — and thus its entire
  // keyframe path — actually renders. Keyframe values stay in gsap space (the
  // path offset is composed separately at runtime), so without this the whole
  // path draws shifted by the offset (e.g. a gesture recorded on a dragged-down
  // element drew its path above the element).
  if ((el.style.translate ?? "").includes("var(")) {
    x += Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-x")) || 0;
    y += Number.parseFloat(el.style.getPropertyValue("--hf-studio-offset-y")) || 0;
  }
  return { x, y };
}

/** Cross-realm-safe HTMLElement check. An element queried from the preview
 *  iframe's document is an instance of the IFRAME window's `HTMLElement`, NOT the
 *  studio window's — so a plain `node instanceof HTMLElement` is always false for
 *  preview nodes. Check against the iframe realm's constructor instead. */
function isPreviewHtmlElement(
  node: Element | null | undefined,
  iframe: HTMLIFrameElement | null,
): node is HTMLElement {
  const Ctor = (iframe?.contentWindow as unknown as { HTMLElement?: typeof HTMLElement } | null)
    ?.HTMLElement;
  return Boolean(node && Ctor && node instanceof Ctor);
}

function rectsClose(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function hasMotionPathPlugin(iframe: HTMLIFrameElement | null): boolean {
  try {
    return Boolean(
      (iframe?.contentWindow as unknown as { MotionPathPlugin?: unknown })?.MotionPathPlugin,
    );
  } catch {
    return false;
  }
}

/** Track the iframe rect (every frame) and the selected element's path geometry
 *  (polled lightly, so it stays fresh through seeks/edits/soft reloads). */
function useMotionPathData(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  selector: string | null,
): {
  rect: Rect | null;
  geometry: MotionPathGeometry | null;
  geometryResolved: boolean;
  visibleInPreview: boolean;
  home: { x: number; y: number } | null;
} {
  const [rect, setRect] = useState<Rect | null>(null);
  const [geometry, setGeometry] = useState<MotionPathGeometry | null>(null);
  // Which selector the current `geometry` was read for. Compared against the live
  // `selector` DURING render so the "resolved" flag is correct on the very first
  // render after a selection change — before the polling effect runs. Until the
  // first read for the new selector lands, `geometry === null` means "unknown",
  // not "no path", so the create-mode hint must stay hidden (otherwise it flashes
  // over an element that already has a path during the new-selection → first-poll
  // gap). A ref (not state) avoids an extra render and a stale-flag window.
  const resolvedForRef = useRef<string | null>(null);
  const geometryResolved = resolvedForRef.current === selector;
  // Whether the target element is actually painted on screen — the path hides when
  // it isn't (e.g. covered by a later scene), matching the selection overlay.
  const [visibleInPreview, setVisibleInPreview] = useState(true);
  // The element's layout-home center, computed from the LIVE current-document
  // element (see below). Path nodes are drawn at home + keyframe offset, so a
  // stale home translates the whole path off the element.
  const [home, setHome] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      setHome(null);
      return;
    }
    // New selector → drop the previous element's anchor immediately; the first
    // tick recomputes it for the new element. Avoids a 1-frame path at the old home.
    setHome(null);
    let raf = 0;
    const tick = () => {
      const el = iframeRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        // Position relative to the preview surface (the `relative overflow-hidden`
        // wrapper) so the SVG is `absolute` inside it and gets clipped to the canvas
        // — instead of `fixed`, which would paint over the side panels at zoom.
        // NOTE: the composition iframe lives in the player's SHADOW DOM, so
        // `el.closest()` can't reach the pan-surface (it stops at the shadow root)
        // and would silently return null → the SVG falls back to raw viewport
        // coords and is offset by the pan-surface's position (worsening with
        // zoom/pan). Query the light DOM via the document instead.
        const surface = el.ownerDocument?.querySelector("[data-preview-pan-surface]");
        const sRect = surface?.getBoundingClientRect();
        const next = {
          left: sRect ? r.left - sRect.left : r.left,
          top: sRect ? r.top - sRect.top : r.top,
          width: r.width,
          height: r.height,
        };
        setRect((prev) => (prev && rectsClose(prev, next) ? prev : next));
        // Resolve the element in the CURRENT iframe document (same one the path
        // geometry reads) — never trust a possibly-stale `selection.element` from a
        // prior document. Soft-reloads (every commit) rebuild the iframe DOM, so a
        // captured node detaches: its offsetLeft/offsetParent collapse and the
        // computed home — hence the whole path — lands in the wrong place.
        let target: Element | null = null;
        try {
          target = el.contentDocument?.querySelector(selector) ?? null;
        } catch {
          /* cross-origin guard */
        }
        const live = isPreviewHtmlElement(target, el) ? target : null;
        // Basic visibility (display/visibility/opacity), NOT the occlusion heuristic:
        // the motion path belongs to the explicitly-selected element, so an opacity-1
        // backgroundless scene "covering" it must not suppress the path — same reason
        // the selection overlay uses isElementVisibleForOverlay (see useDomEditOverlayRects).
        const vis = live ? isElementVisibleForOverlay(live) : true;
        setVisibleInPreview((prev) => (prev === vis ? prev : vis));
        if (live) {
          const h = elementHome(live);
          setHome((prev) =>
            prev && Math.abs(prev.x - h.x) < 0.5 && Math.abs(prev.y - h.y) < 0.5 ? prev : h,
          );
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selector, iframeRef]);

  useEffect(() => {
    if (!selector) {
      setGeometry(null);
      return;
    }
    // Poll the runtime: edits commit with an in-place soft reload (the timeline
    // re-executes without an iframe load or a refresh-version bump), so there's
    // no event to subscribe to. The read is cheap and the points-equality guard
    // suppresses redundant re-renders. ponytail: a shared gsap-soft-reload
    // version signal would let this (and future overlays) go event-driven —
    // that's a cross-cutting change tracked with the soft-reload work, not here.
    const recompute = () => {
      const read = readRuntimeKeyframes(iframeRef.current, selector);
      const next = buildMotionPathGeometry(read);
      // Compare the discriminator too, not just coords: a degenerate transition
      // (linear ⇄ arc with identical points) must re-render so the geometry kind
      // — which drives node refs, add/remove affordances and commit routing —
      // stays in sync. Points alone would keep the stale `kind`.
      setGeometry((prev) =>
        prev?.points === next?.points && prev?.kind === next?.kind ? prev : next,
      );
      resolvedForRef.current = selector;
    };
    recompute();
    const id = window.setInterval(recompute, 250);
    return () => window.clearInterval(id);
  }, [selector, iframeRef]);

  return { rect, geometry, geometryResolved, visibleInPreview, home };
}

/**
 * Draws the selected element's GSAP motion path over the canvas — a dashed
 * polyline through its x/y keyframes (or motionPath waypoints) with a draggable
 * node at each. Dragging an x/y node rewrites the keyframe; dragging a waypoint
 * rewrites the motionPath point; both commit to source (undoable). Renders in
 * declared composition coordinates so the path doesn't drift under GSAP
 * transforms. Read-only (no drag) while playing or when the tween isn't
 * statically editable. Nothing renders when the selection has no positional
 * motion.
 */
// fallow-ignore-next-line complexity
export const MotionPathOverlay = memo(function MotionPathOverlay({
  iframeRef,
  selection,
  compositionSize,
  isPlaying,
}: MotionPathOverlayProps) {
  const {
    commitMutation,
    selectedGsapAnimations,
    handleGsapRemoveKeyframe,
    handleGsapDeleteAllForElement,
  } = useDomEditContext();
  const { rect, geometry, geometryResolved, visibleInPreview, home } = useMotionPathData(
    iframeRef,
    selectorFor(selection),
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; segIndex: number } | null>(null);
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  // Right-click context menu on a keyframe node — same delete actions as the
  // timeline keyframe diamond.
  const [kfMenu, setKfMenu] = useState<KeyframeDiamondContextMenuState | null>(null);
  // The keyframe % selected by clicking its node — highlighted, and the next drag
  // modifies it rather than adding a keyframe.
  const activeKeyframePct = usePlayerStore((s) => s.activeKeyframePct);
  // Set-destination mode is armed from the preview toolbar (replaces the old
  // double-click-on-canvas UX). See createMode effects below.
  const armed = usePlayerStore((s) => s.motionPathArmed);
  const setMotionPathArmed = usePlayerStore((s) => s.setMotionPathArmed);
  const setMotionPathCreateAvailable = usePlayerStore((s) => s.setMotionPathCreateAvailable);
  const dragRef = useRef<DragState | null>(null);
  // Park-on-click is debounced so a double-click cancels the seek (see onUp).
  const parkTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The animation id whose path is currently editable. Computed at hook level (not
  // just in render, after the early returns) so the park-timer cleanup can key on
  // it: a pending park seek belongs to the OLD animation, so firing it after the
  // active animation changed would jump the playhead onto a stale keyframe.
  const animId = editableAnimationId(selectedGsapAnimations ?? [], geometry?.kind ?? "linear");
  // Clear the debounced park timer on unmount AND whenever the active animation id
  // changes — not unmount-only, or a queued seek from the previous selection still
  // fires against the new one.
  useEffect(() => () => clearTimeout(parkTimerRef.current), [animId]);

  // Create mode: a selected element with no positional motion can be given a new
  // motionPath. Gated on `geometryResolved` so a fresh selection never counts as
  // "no path" before the first runtime read confirms it (see useMotionPathData).
  const createMode = geometryResolved && !geometry && Boolean(selection?.element) && !isPlaying;
  const createSelector = createMode ? selectorFor(selection) : null;
  const compW = compositionSize?.width ?? null;
  const canCreate = createMode && hasMotionPathPlugin(iframeRef.current);

  // Publish whether the selected element can take a path so the preview toolbar
  // shows its "set destination" toggle. Drops to false when this overlay unmounts
  // or the context changes, so the button never lingers for a stale selection.
  useEffect(() => {
    setMotionPathCreateAvailable(Boolean(canCreate));
    return () => setMotionPathCreateAvailable(false);
  }, [canCreate, setMotionPathCreateAvailable]);

  // Disarm when set-destination is no longer possible (element gains a path, gets
  // deselected, or playback starts) so a toggle left on can't fire later.
  useEffect(() => {
    if (armed && !canCreate) setMotionPathArmed(false);
  }, [armed, canCreate, setMotionPathArmed]);

  // While armed, the next canvas press sets the destination (replaces the old
  // double-click). Scoped to the preview pan-surface in the CAPTURE phase, on
  // pointerdown, so it fires before the selection/drag handler underneath — a
  // press on empty canvas would otherwise deselect (and disarm) before a later
  // click could land. stopPropagation keeps that handler from also running.
  // fallow-ignore-next-line complexity
  useEffect(() => {
    if (!armed || !createSelector || !compW) return;
    const surface =
      (iframeRef.current?.ownerDocument?.querySelector(
        "[data-preview-pan-surface]",
      ) as HTMLElement | null) ?? null;
    if (!surface) return;
    const prevCursor = surface.style.cursor;
    surface.style.cursor = "crosshair";
    // fallow-ignore-next-line complexity
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return; // primary press only
      const frame = iframeRef.current;
      if (!frame || !hasMotionPathPlugin(frame)) return;
      const r = frame.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
        return;
      }
      // Resolve the element LIVE from the current iframe document — the selected
      // node may be detached after a soft-reload, which would skew home.
      const live = frame.contentDocument?.querySelector(createSelector);
      if (!isPreviewHtmlElement(live, frame)) return;
      e.stopPropagation();
      e.preventDefault();
      const sc = r.width / compW;
      const elHome = elementHome(live);
      const px = Math.round((e.clientX - r.left) / sc - elHome.x);
      const py = Math.round((e.clientY - r.top) / sc - elHome.y);
      const t = Math.round(usePlayerStore.getState().currentTime * 100) / 100;
      void commitCreatePath(createSelector, t, px, py, commitMutation);
      setMotionPathArmed(false);
    };
    surface.addEventListener("pointerdown", onDown, true);
    return () => {
      surface.removeEventListener("pointerdown", onDown, true);
      surface.style.cursor = prevCursor;
    };
  }, [armed, createSelector, compW, iframeRef, commitMutation, setMotionPathArmed]);

  if (!rect || rect.width <= 0 || !compositionSize || compositionSize.width <= 0) return null;
  // Hide the whole overlay (path + create hint) when the element isn't painted —
  // same "what you see in the preview" rule as the selection box.
  if (!visibleInPreview) return null;
  // No live anchor (element not in the current document) → can't place the path.
  if (!home) return null;

  if (!geometry) {
    // Create mode draws nothing by default — the destination is set via the
    // preview toolbar's "set destination" toggle (no text sprawled over the
    // canvas). Only while armed do we show a faint ring at the element as a
    // "click to place" cue (the surface cursor is also crosshair, set above).
    if (!armed || !canCreate) return null;
    const sc = rect.width / compositionSize.width;
    const hr = (NODE_PX / sc) * 1.6;
    return (
      <svg
        className="pointer-events-none absolute z-40"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          // Don't clip the ring that extends past the canvas into the gray margin
          // — only the preview viewport (`[data-preview-pan-surface]`,
          // overflow-hidden) clips, so overlays reach the edge but never the panels.
          overflow: "visible",
        }}
        viewBox={`0 0 ${compositionSize.width} ${compositionSize.height}`}
      >
        <circle
          cx={home.x}
          cy={home.y}
          r={hr}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: ACCENT }}
          opacity={0.85}
        />
      </svg>
    );
  }

  const scale = rect.width / compositionSize.width;
  const nodeR = NODE_PX / scale;
  const interactive = Boolean(animId) && !isPlaying;
  // The × "quick remove" badge applies to non-cubic motionPath arcs only (cubic
  // anchors carry control points we don't synthesize; keyframe paths remove via
  // the right-click menu instead).
  const arcAnim = animId ? selectedGsapAnimations?.find((a) => a.id === animId) : undefined;
  const isCubic = arcAnim?.arcPath?.segments?.some((s) => s.cp1 != null) ?? false;
  const structural = geometry.kind === "arc" && interactive && !isCubic;
  const removable = structural && geometry.nodes.length > 2;
  // Click-on-path to insert a node works for both kinds: a motionPath waypoint
  // (non-cubic arcs), or an x/y keyframe (linear paths) at the projected tween-%.
  const addable = interactive && (geometry.kind === "arc" ? !isCubic : true);

  const nodes = draft
    ? geometry.nodes.map((n, i) => (i === draft.index ? { ...n, x: draft.x, y: draft.y } : n))
    : geometry.nodes;
  // ax/ay = absolute composition position (home + offset) for drawing; n.x/n.y
  // stay offsets so the drag commit writes the right tween values.
  const abs = nodes.map((n) => ({ ...n, ax: home.x + n.x, ay: home.y + n.y }));
  const points = abs.map((p) => `${p.ax},${p.ay}`).join(" ");
  // Map a VIEWPORT pointer to composition space. Use the iframe's LIVE viewport
  // rect, not `rect` — `rect.left/top` are stored pan-surface-relative (for the
  // absolute-positioned SVG), so subtracting them from a viewport clientX/Y would
  // offset the projection by the surface's gutter (panel/toolbar), and the add-
  // ghost wouldn't track the cursor. `scale` is unaffected (width is stored raw).
  const clientToComp = (e: React.PointerEvent) => {
    const vr = iframeRef.current?.getBoundingClientRect();
    const left = vr ? vr.left : rect.left;
    const top = vr ? vr.top : rect.top;
    return { x: (e.clientX - left) / scale, y: (e.clientY - top) / scale };
  };

  const onDown = (
    e: React.PointerEvent,
    index: number,
    x: number,
    y: number,
    ref: MotionNodeRef,
  ) => {
    if (!interactive) return;
    if (e.button !== 0) return; // primary button only — right-click is the context menu
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      index,
      startX: e.clientX,
      startY: e.clientY,
      initX: x,
      initY: y,
      scale,
      ref,
    };
    setDraft({ index, x, y });
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setDraft({
      index: d.index,
      x: d.initX + (e.clientX - d.startX) / d.scale,
      y: d.initY + (e.clientY - d.startY) / d.scale,
    });
  };
  // fallow-ignore-next-line complexity
  const onUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDraft(null);
    if (!animId) return;
    const screenDx = e.clientX - d.startX;
    const screenDy = e.clientY - d.startY;
    const x = Math.round(d.initX + screenDx / d.scale);
    const y = Math.round(d.initY + screenDy / d.scale);
    // Click-vs-drag is decided in SCREEN space, not composition px: the old guard
    // compared rounded comp-px, which at high zoom (scale ≫ 1) swallowed real
    // multi-px screen drags whose sub-comp-px delta rounds to 0 → the node would
    // never move. A screen-distance threshold registers any genuine pointer drag
    // at any zoom; below it the gesture is a click (select + park the playhead).
    const movedScreenPx = Math.hypot(screenDx, screenDy);
    if (movedScreenPx < DRAG_THRESHOLD_PX) {
      // No drag → treat as a click: select this keyframe and park the playhead on
      // it. Selecting it makes the next drag MODIFY this keyframe (honored via
      // activeKeyframePct) instead of creating a new one.
      if (d.ref.type === "keyframe") {
        usePlayerStore.getState().setActiveKeyframePct(d.ref.pct);
        const ref = d.ref;
        // Debounce the playhead seek: a double-click cancels it (e.detail >= 2),
        // so only a lone single-click parks the playhead on the keyframe.
        clearTimeout(parkTimerRef.current);
        if (e.detail < 2) {
          parkTimerRef.current = setTimeout(() => {
            const anim = selectedGsapAnimations?.find((a) => a.id === animId);
            if (anim) parkPlayheadOnKeyframe(anim, ref.pct);
          }, 250);
        }
      }
      return; // no commit
    }
    // A real drag that still rounds to the same integer comp-px (sub-px move at
    // high zoom) would commit an identical value — a no-op undo entry. Skip the
    // commit, but don't treat it as a click either (the user did drag).
    if (x === Math.round(d.initX) && y === Math.round(d.initY)) return;
    void commitNode(d.ref, x, y, animId, commitMutation);
    // Park the playhead on the edited keyframe's time so the element previews AT
    // that keyframe. Without it, a playhead sitting before the tween renders the
    // element's base pose — the edit (correct on the path) looks like it vanished.
    if (d.ref.type === "keyframe") {
      const anim = selectedGsapAnimations?.find((a) => a.id === animId);
      if (anim) parkPlayheadOnKeyframe(anim, d.ref.pct);
    }
  };

  // Ghost "add" affordance: project the cursor onto the path; click inserts.
  const onPathHover = (e: React.PointerEvent) => {
    const c = clientToComp(e);
    const np = nearestPointOnPath(
      c.x,
      c.y,
      abs.map((p) => ({ x: p.ax, y: p.ay })),
    );
    setGhost(np ? { x: np.x, y: np.y, segIndex: np.segIndex } : null);
  };
  const onPathDown = (e: React.PointerEvent) => {
    if (!animId) return;
    // Compute the insertion point from the event directly so a click works
    // without (or faster than) a preceding hover.
    const c = clientToComp(e);
    const np = nearestPointOnPath(
      c.x,
      c.y,
      abs.map((p) => ({ x: p.ax, y: p.ay })),
    );
    if (!np) return;
    const x = Math.round(np.x - home.x);
    const y = Math.round(np.y - home.y);
    if (geometry.kind === "arc") {
      e.stopPropagation();
      void commitAddWaypoint(animId, np.segIndex + 1, x, y, commitMutation);
    } else {
      // Linear keyframe path: interpolate the new stop's tween-% from the two
      // keyframes bounding the clicked segment (np.t = fraction along it), then
      // insert it. Lands ON the current line, so the dot doesn't jump — drag it
      // after to bend the path.
      const a = abs[np.segIndex]?.ref;
      const b = abs[np.segIndex + 1]?.ref;
      if (a?.type !== "keyframe" || b?.type !== "keyframe") return;
      const pct = Math.round((a.pct + (b.pct - a.pct) * np.t) * 1000) / 1000;
      e.stopPropagation();
      void commitAddKeyframe(animId, pct, x, y, commitMutation);
    }
    setGhost(null);
  };
  const onRemove = (e: React.PointerEvent, index: number) => {
    e.stopPropagation();
    if (!animId) return;
    setHoverNode(null);
    void commitRemoveWaypoint(animId, index, commitMutation);
  };

  const elementId = selection?.id ?? null;
  // Right-click a keyframe node → the timeline's keyframe context menu (delete
  // this keyframe / delete all), so motion-path keyframes are removable in place.
  const onNodeContextMenu = (e: React.MouseEvent, ref: MotionNodeRef) => {
    if (ref.type !== "keyframe" || !animId || !elementId) return;
    e.preventDefault();
    e.stopPropagation();
    setKfMenu({
      x: e.clientX,
      y: e.clientY,
      elementId,
      percentage: ref.pct,
      tweenPercentage: ref.pct,
    });
  };

  return (
    <>
      <svg
        className="pointer-events-none absolute z-40"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          // Don't clip nodes/path past the canvas into the gray margin — only the
          // preview viewport (overflow-hidden) clips, so overlays reach the edge
          // but never the side panels.
          overflow: "visible",
        }}
        viewBox={`0 0 ${compositionSize.width} ${compositionSize.height}`}
      >
        {/* Wide transparent hit path drives the add-ghost; drawn under the nodes.
            Renders for keyframe paths and non-cubic arcs (see `addable`). */}
        {addable && (
          <polyline
            points={points}
            fill="none"
            stroke="transparent"
            strokeWidth={14 / scale}
            className="pointer-events-auto"
            style={{ cursor: "copy" }}
            onPointerMove={onPathHover}
            onPointerLeave={() => setGhost(null)}
            onPointerDown={onPathDown}
          />
        )}
        <polyline
          points={points}
          fill="none"
          style={{ stroke: ACCENT }}
          strokeWidth={1.5}
          strokeDasharray="5 5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          opacity={0.85}
        />
        {ghost && (
          <rect
            x={ghost.x - nodeR * 0.707}
            y={ghost.y - nodeR * 0.707}
            width={nodeR * 1.414}
            height={nodeR * 1.414}
            rx={nodeR * 0.24}
            transform={`rotate(45 ${ghost.x} ${ghost.y})`}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
            className="pointer-events-none"
            style={{ stroke: ACCENT }}
          />
        )}
        {abs.map((p, i) => (
          <MotionPathNode
            key={i}
            cx={p.ax}
            cy={p.ay}
            r={nodeR}
            interactive={interactive}
            removable={removable && hoverNode === i}
            grabbing={draft?.index === i}
            selected={p.ref.type === "keyframe" && p.ref.pct === activeKeyframePct}
            onEnter={() => setHoverNode(i)}
            onLeave={() => setHoverNode((h) => (h === i ? null : h))}
            onPointerDown={(e) => onDown(e, i, p.x, p.y, p.ref)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onRemove={(e) => onRemove(e, i)}
            onContextMenu={(e) => onNodeContextMenu(e, p.ref)}
          />
        ))}
      </svg>
      {kfMenu && (
        <KeyframeDiamondContextMenu
          state={kfMenu}
          onClose={() => setKfMenu(null)}
          onDelete={(_elId, pct) => animId && handleGsapRemoveKeyframe(animId, pct)}
          onDeleteAll={(elId) => handleGsapDeleteAllForElement(`#${elId}`)}
        />
      )}
    </>
  );
});
