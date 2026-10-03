/**
 * Sample-time `data-safe-critical` overflow against authored `data-safe-frames`.
 *
 * Static lint cannot know painted overflow; `hyperframes check` and `inspect`
 * compare visible border boxes to the shared {@link pixelRect} snap.
 */

import {
  elementRequiresFrame,
  parseSafeFramesAttribute,
  pixelRect,
  type PixelRect,
  type SafeFrame,
} from "@hyperframes/parsers/safe-frames";
import { computeOverflow, type LayoutIssue, type LayoutRect } from "./layoutAudit.js";
import type { CheckAnchor } from "./checkTypes.js";
import type { Page } from "puppeteer-core";

export interface AuthoredSafeFramePixels {
  id: string;
  ratio: SafeFrame["ratio"];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SafeCriticalOverflow {
  time: number;
  elementId: string;
  selector: string;
  frameId: string;
  edges: Array<"left" | "right" | "top" | "bottom">;
  overflow: NonNullable<LayoutIssue["overflow"]>;
}

export interface SafeCriticalElementSnapshot {
  id: string;
  selector: string;
  criticalAttr: string | null;
  hasCritical: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  hidden: boolean;
}

export interface SafeCriticalSnapshot {
  time: number;
  compositionWidth: number;
  compositionHeight: number;
  framesAttr: string | null;
  rootLeft: number;
  rootTop: number;
  elements: SafeCriticalElementSnapshot[];
}

function pixelRectToLayout(rect: PixelRect): LayoutRect {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
  };
}

function elementBoxInComposition(
  element: SafeCriticalElementSnapshot,
  rootLeft: number,
  rootTop: number,
): LayoutRect {
  const left = element.left - rootLeft;
  const top = element.top - rootTop;
  return {
    left,
    top,
    right: left + element.width,
    bottom: top + element.height,
    width: element.width,
    height: element.height,
  };
}

function overflowingEdges(
  overflow: NonNullable<LayoutIssue["overflow"]>,
): Array<"left" | "right" | "top" | "bottom"> {
  const edges: Array<"left" | "right" | "top" | "bottom"> = [];
  if (overflow.left != null) edges.push("left");
  if (overflow.right != null) edges.push("right");
  if (overflow.top != null) edges.push("top");
  if (overflow.bottom != null) edges.push("bottom");
  return edges;
}

function edgeLabel(edges: Array<"left" | "right" | "top" | "bottom">): string {
  if (edges.length === 1) return `the ${edges[0]} edge`;
  if (edges.length === 2) return `the ${edges[0]} and ${edges[1]} edges`;
  const last = edges[edges.length - 1];
  return `the ${edges.slice(0, -1).join(", ")}, and ${last} edges`;
}

function authoredSafeFramePixels(
  frames: SafeFrame[],
  width: number,
  height: number,
): AuthoredSafeFramePixels[] {
  return frames.map((frame) => {
    const rect = pixelRect(frame, width, height);
    return { id: frame.id, ratio: frame.ratio, ...rect };
  });
}

/**
 * Compare visible `data-safe-critical` boxes against required pixel rects.
 * Hidden (`display:none` / `visibility:hidden` / zero-size / off-clip) boxes
 * are skipped. A box that leaves its frame is a blocking finding.
 */
// fallow-ignore-next-line complexity
export function evaluateSafeCriticalOverflows(
  snapshot: SafeCriticalSnapshot,
  tolerance = 0,
): { frames: AuthoredSafeFramePixels[]; overflows: SafeCriticalOverflow[]; issues: LayoutIssue[] } {
  if (!(snapshot.compositionWidth > 0) || !(snapshot.compositionHeight > 0)) {
    return { frames: [], overflows: [], issues: [] };
  }
  const parsed = parseSafeFramesAttribute(snapshot.framesAttr, {
    width: snapshot.compositionWidth,
    height: snapshot.compositionHeight,
  });
  if (!parsed.ok || parsed.frames.length === 0) {
    return { frames: [], overflows: [], issues: [] };
  }
  const frames = authoredSafeFramePixels(
    parsed.frames,
    snapshot.compositionWidth,
    snapshot.compositionHeight,
  );
  const overflows: SafeCriticalOverflow[] = [];
  const issues: LayoutIssue[] = [];
  for (const element of snapshot.elements) {
    if (!element.hasCritical || element.hidden) continue;
    const reader = {
      getAttribute: (name: string) => (name === "data-safe-critical" ? element.criticalAttr : null),
      hasAttribute: (name: string) => name === "data-safe-critical" && element.hasCritical,
    };
    const box = elementBoxInComposition(element, snapshot.rootLeft, snapshot.rootTop);
    for (const frame of parsed.frames) {
      if (!elementRequiresFrame(reader, frame.id)) continue;
      const container = pixelRectToLayout(
        pixelRect(frame, snapshot.compositionWidth, snapshot.compositionHeight),
      );
      const overflow = computeOverflow(box, container, tolerance);
      if (!overflow) continue;
      const edges = overflowingEdges(overflow);
      const elementId = element.id || element.selector;
      const selector = element.selector || (element.id ? `#${element.id}` : "[data-safe-critical]");
      overflows.push({
        time: snapshot.time,
        elementId,
        selector,
        frameId: frame.id,
        edges,
        overflow,
      });
      issues.push({
        code: "safe_critical_overflow",
        severity: "error",
        time: snapshot.time,
        selector,
        text: element.id || undefined,
        message: `${element.id ? `#${element.id}` : selector} overflows safe frame "${frame.id}" at t=${snapshot.time}s on ${edgeLabel(edges)}.`,
        rect: box,
        containerRect: container,
        overflow,
        fixHint:
          "Keep the element inside the authored crop window. Cropping does not reflow layout.",
      });
    }
  }
  return { frames, overflows, issues };
}

export function snapshotToAnchoredIssues(
  snapshot: SafeCriticalSnapshot,
  tolerance: number,
  sourceFile: string,
): Array<LayoutIssue & CheckAnchor> {
  const { issues } = evaluateSafeCriticalOverflows(snapshot, tolerance);
  return issues.map((issue) => ({
    ...issue,
    dataAttributes: {},
    sourceFile,
    bbox: {
      x: issue.rect.left,
      y: issue.rect.top,
      width: issue.rect.width,
      height: issue.rect.height,
    },
  }));
}

export async function collectSafeCriticalSnapshotFromPage(
  page: Page,
  time: number,
): Promise<SafeCriticalSnapshot> {
  const raw = (await page.evaluate(() => {
    const root = document.querySelector("[data-composition-id]");
    if (!(root instanceof HTMLElement)) {
      return {
        compositionWidth: 0,
        compositionHeight: 0,
        framesAttr: null as string | null,
        rootLeft: 0,
        rootTop: 0,
        elements: [] as Array<{
          id: string;
          selector: string;
          criticalAttr: string | null;
          hasCritical: boolean;
          left: number;
          top: number;
          width: number;
          height: number;
          hidden: boolean;
        }>,
      };
    }
    const rootRect = root.getBoundingClientRect();
    const width = Number.parseFloat(root.getAttribute("data-width") ?? "");
    const height = Number.parseFloat(root.getAttribute("data-height") ?? "");
    const elements = Array.from(document.querySelectorAll("[data-safe-critical]")).flatMap(
      (node) => {
        if (!(node instanceof HTMLElement)) return [];
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        const hidden =
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0" ||
          rect.width === 0 ||
          rect.height === 0;
        return [
          {
            id: node.id,
            selector: node.id ? `#${node.id}` : node.tagName.toLowerCase(),
            criticalAttr: node.getAttribute("data-safe-critical"),
            hasCritical: node.hasAttribute("data-safe-critical"),
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            hidden,
          },
        ];
      },
    );
    return {
      compositionWidth: Number.isFinite(width) ? width : 0,
      compositionHeight: Number.isFinite(height) ? height : 0,
      framesAttr: root.getAttribute("data-safe-frames"),
      rootLeft: rootRect.left,
      rootTop: rootRect.top,
      elements,
    };
  })) as Omit<SafeCriticalSnapshot, "time">;
  return { ...raw, time };
}
