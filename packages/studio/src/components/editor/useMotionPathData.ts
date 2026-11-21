import { useEffect, useRef, useState, type RefObject } from "react";
import { isHtmlElement } from "@hyperframes/core/runtime/dom-realm";
import { readRuntimeKeyframes } from "../../hooks/gsapRuntimeKeyframes";
import { readGsapPositionFromIframe } from "../../hooks/gsapPositionDetection";
import { elementHome, transformWDivisor } from "@hyperframes/core/runtime/editing-port";
import { isElementVisibleForOverlay } from "./domEditOverlayGeometry";
import {
  buildMotionPathGeometry,
  type MotionPathGeometry,
  type MotionPathHome,
} from "./motionPathGeometry";
import { subscribeOverlayFrame } from "./overlayFrameLoop";
import { usePlayerStore } from "../../player/store/playerStore";
import { previewFrameOpaque, previewRequest } from "../../player/lib/previewChannel";

type Rect = { left: number; top: number; width: number; height: number };

function rectsClose(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

const sealedPlugins = new WeakMap<HTMLIFrameElement, boolean>();

export function hasMotionPathPlugin(iframe: HTMLIFrameElement | null): boolean {
  if (iframe && previewFrameOpaque(iframe)) return sealedPlugins.get(iframe) ?? false;
  try {
    return Boolean(
      (iframe?.contentWindow as unknown as { MotionPathPlugin?: unknown })?.MotionPathPlugin,
    );
  } catch {
    return false;
  }
}

type SealedHome = { visible: boolean; home: MotionPathHome | null; perspective: number };

const sameHome = (a: MotionPathHome, b: MotionPathHome) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  a.w === b.w &&
  a.h === b.h &&
  a.ax === b.ax &&
  a.ay === b.ay;

const HOME_FIELDS = ["x", "y", "w", "h", "ax", "ay"] as const;

/** The reply is frame data, so its shape is checked. */
function readHome(value: unknown): MotionPathHome | null {
  if (typeof value !== "object" || value === null) return null;
  const fields = value as Record<string, unknown>;
  const ok = HOME_FIELDS.every((name) => Number.isFinite(fields[name]));
  return ok ? (Object.fromEntries(HOME_FIELDS.map((n) => [n, fields[n]])) as MotionPathHome) : null;
}

/** Where a sealed frame's first match of `selector` draws its path from; null when it cannot say. */
export async function sealedMotionPathHome(
  iframe: HTMLIFrameElement,
  selector: string,
): Promise<(SealedHome & { plugin: boolean }) | null> {
  const reply = await previewRequest(iframe, "motion-path-home", { selector });
  if (!reply || typeof reply.plugin !== "boolean" || typeof reply.visible !== "boolean")
    return null;
  sealedPlugins.set(iframe, reply.plugin);
  const perspective =
    Number.isFinite(reply.perspective) && reply.perspective > 0 ? reply.perspective : 1;
  return { visible: reply.visible, home: readHome(reply.home), perspective, plugin: reply.plugin };
}

export function useMotionPathData(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  selector: string | null,
): {
  rect: Rect | null;
  geometry: MotionPathGeometry | null;
  geometryResolved: boolean;
  visibleInPreview: boolean;
  home: MotionPathHome | null;
  pScale: number;
} {
  const [rect, setRect] = useState<Rect | null>(null);
  const [geometry, setGeometry] = useState<MotionPathGeometry | null>(null);
  const resolvedForRef = useRef<string | null>(null);
  const geometryResolved = resolvedForRef.current === selector;
  const [visibleInPreview, setVisibleInPreview] = useState(true);
  const [home, setHome] = useState<MotionPathHome | null>(null);
  // Perspective magnification (1/m44) of the selected element — applied to the
  // path's offset points so depth (translateZ) elements' paths track on screen.
  const [pScale, setPScale] = useState(1);
  const armed = usePlayerStore((s) => s.motionPathArmed);
  const drawn = geometry !== null || armed;

  useEffect(() => {
    if (!selector) {
      setRect(null);
      setHome(null);
      return;
    }
    setHome(null);
    if (!drawn) return;
    const tick = () => {
      const el = iframeRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const surface = el.ownerDocument?.querySelector("[data-preview-pan-surface]");
        const sRect = surface?.getBoundingClientRect();
        const next = {
          left: sRect ? r.left - sRect.left : r.left,
          top: sRect ? r.top - sRect.top : r.top,
          width: r.width,
          height: r.height,
        };
        setRect((prev) => (prev && rectsClose(prev, next) ? prev : next));
        if (previewFrameOpaque(el)) {
          askSealed(el);
          return;
        }
        let target: Element | null = null;
        try {
          target = el.contentDocument?.querySelector(selector) ?? null;
        } catch {
          /* cross-origin guard */
        }
        const live = isHtmlElement(target) ? target : null;
        if (!live) apply({ visible: true, home: null, perspective: 1 });
        else {
          const visible = isElementVisibleForOverlay(live);
          apply({ visible, home: elementHome(live), perspective: 1 / transformWDivisor(live) });
        }
      }
    };
    const apply = ({ visible, home: h, perspective: ps }: SealedHome) => {
      setVisibleInPreview((prev) => (prev === visible ? prev : visible));
      if (!h) return;
      setHome((prev) => (prev && sameHome(prev, h) ? prev : h));
      setPScale((p) => (Math.abs(p - ps) < 0.001 ? p : ps));
    };
    // One request at a time; a tick while it is out skips, the next one after it asks again.
    let asking = false;
    let stopped = false;
    const askSealed = (frame: HTMLIFrameElement) => {
      if (asking) return;
      asking = true;
      void sealedMotionPathHome(frame, selector).then((reply) => {
        asking = false;
        if (reply && !stopped) apply(reply);
      });
    };
    const stop = subscribeOverlayFrame(tick);
    return () => {
      stopped = true;
      stop();
    };
  }, [selector, iframeRef, drawn]);

  // A sealed frame says whether it has the plugin only when asked; re-render once it has.
  const [, notePlugin] = useState(false);
  useEffect(() => {
    const frame = iframeRef.current;
    if (!selector || !frame || !previewFrameOpaque(frame)) return;
    let current = true;
    void sealedMotionPathHome(frame, selector).then((reply) => {
      if (current && reply) notePlugin(reply.plugin);
    });
    return () => {
      current = false;
    };
  }, [selector, iframeRef]);

  useEffect(() => {
    if (!selector) {
      setGeometry(null);
      return;
    }
    const recompute = () => {
      // Position-only: never let a co-located size/scale tween shadow the path.
      const read = readRuntimeKeyframes(iframeRef.current, selector, undefined, ["x", "y"]);
      const base = read ? readGsapPositionFromIframe(iframeRef.current, selector) : null;
      const next = buildMotionPathGeometry(read, base ?? undefined);
      setGeometry((prev) =>
        prev?.kind === next?.kind &&
        JSON.stringify([prev?.nodes, prev?.start]) === JSON.stringify([next?.nodes, next?.start])
          ? prev
          : next,
      );
      resolvedForRef.current = selector;
    };
    recompute();
    const id = window.setInterval(recompute, 250);
    return () => window.clearInterval(id);
  }, [selector, iframeRef]);

  return { rect, geometry, geometryResolved, visibleInPreview, home, pScale };
}
