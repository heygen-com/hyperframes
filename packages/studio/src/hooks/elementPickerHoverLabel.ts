import type { HyperframePickerBoundingBox } from "@hyperframes/core";

const LABEL_GAP_PX = 6;
const LABEL_MAX_CHARS = 72;

export interface ElementPickerHoverInfo {
  id: string | null;
  className?: string | null;
  tagName: string;
  boundingBox: HyperframePickerBoundingBox;
}

export function formatElementPickerIdentifier(info: ElementPickerHoverInfo): string {
  const tag = info.tagName.trim().toLowerCase() || "element";
  const id = info.id?.trim();
  const firstClass = info.className
    ?.split(/\s+/)
    .find((name) => name.length > 0 && !name.startsWith("__hf-"));
  const identifier = id ? `${tag}#${id}` : firstClass ? `${tag}.${firstClass}` : tag;
  const characters = Array.from(identifier);
  return characters.length > LABEL_MAX_CHARS
    ? `${characters.slice(0, LABEL_MAX_CHARS - 1).join("")}…`
    : identifier;
}

interface LabelPositionInput {
  iframeRect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">;
  iframeWidth: number;
  iframeHeight: number;
  elementBox: HyperframePickerBoundingBox;
  labelWidth: number;
  labelHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

export function elementPickerLabelPosition(input: LabelPositionInput): {
  left: number;
  top: number;
} {
  const scaleX = input.iframeWidth > 0 ? input.iframeRect.width / input.iframeWidth : 1;
  const scaleY = input.iframeHeight > 0 ? input.iframeRect.height / input.iframeHeight : 1;
  const elementLeft = input.iframeRect.left + input.elementBox.x * scaleX;
  const elementRight = elementLeft + input.elementBox.width * scaleX;
  const elementTop = input.iframeRect.top + input.elementBox.y * scaleY;
  const minLeft = Math.max(0, input.iframeRect.left);
  const maxRight = Math.min(input.viewportWidth, input.iframeRect.right);
  const minTop = Math.max(0, input.iframeRect.top);
  const maxBottom = Math.min(input.viewportHeight, input.iframeRect.bottom);
  const maxLeft = Math.max(minLeft, maxRight - input.labelWidth);
  const maxTop = Math.max(minTop, maxBottom - input.labelHeight);
  const besideRight = elementRight + LABEL_GAP_PX;
  const besideLeft = elementLeft - input.labelWidth - LABEL_GAP_PX;
  const preferredLeft = besideRight + input.labelWidth <= maxRight ? besideRight : besideLeft;

  return {
    left: Math.min(maxLeft, Math.max(minLeft, preferredLeft)),
    top: Math.min(maxTop, Math.max(minTop, elementTop)),
  };
}

export interface ElementPickerHoverLabel {
  show: (info: ElementPickerHoverInfo, iframe: HTMLIFrameElement) => void;
  clear: () => void;
  dispose: () => void;
}

function firstPositive(values: number[]): number {
  return values.find((value) => value > 0) ?? 0;
}

function iframeLayoutSize(
  iframe: HTMLIFrameElement,
  rect: DOMRect,
): {
  width: number;
  height: number;
} {
  return {
    width: firstPositive([iframe.clientWidth, iframe.offsetWidth, rect.width]),
    height: firstPositive([iframe.clientHeight, iframe.offsetHeight, rect.height]),
  };
}

function viewportSize(doc: Document): { width: number; height: number } {
  const view = doc.defaultView;
  return view
    ? { width: view.innerWidth, height: view.innerHeight }
    : { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight };
}

export function createElementPickerHoverLabel(doc: Document = document): ElementPickerHoverLabel {
  const label = doc.createElement("div");
  label.dataset.hfPickerHoverLabel = "";
  label.ariaHidden = "true";
  Object.assign(label.style, {
    position: "fixed",
    zIndex: "100",
    pointerEvents: "none",
    maxWidth: "220px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    border: "1px solid color-mix(in oklab, var(--color-studio-accent) 55%, transparent)",
    borderRadius: "4px",
    background: "var(--color-studio-bg)",
    color: "var(--color-studio-text)",
    boxShadow: "var(--shadow-popover)",
    padding: "2px 6px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "10px",
    lineHeight: "16px",
  });

  let current: { info: ElementPickerHoverInfo; iframe: HTMLIFrameElement } | null = null;
  let animationFrame: number | null = null;

  const draw = () => {
    if (!current || !current.iframe.isConnected) {
      clear();
      return;
    }
    if (!label.isConnected) doc.body.appendChild(label);
    label.textContent = formatElementPickerIdentifier(current.info);
    const iframeRect = current.iframe.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    const iframeSize = iframeLayoutSize(current.iframe, iframeRect);
    const viewport = viewportSize(doc);
    const position = elementPickerLabelPosition({
      iframeRect,
      iframeWidth: iframeSize.width,
      iframeHeight: iframeSize.height,
      elementBox: current.info.boundingBox,
      labelWidth: labelRect.width,
      labelHeight: labelRect.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    });
    label.style.left = `${position.left}px`;
    label.style.top = `${position.top}px`;
  };

  const tick = () => {
    animationFrame = null;
    draw();
    if (current && doc.defaultView) animationFrame = doc.defaultView.requestAnimationFrame(tick);
  };

  const startTracking = () => {
    if (animationFrame === null && doc.defaultView) {
      animationFrame = doc.defaultView.requestAnimationFrame(tick);
    }
  };

  function clear(): void {
    current = null;
    if (animationFrame !== null && doc.defaultView) {
      doc.defaultView.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    label.remove();
  }

  return {
    show(info, iframe) {
      current = { info, iframe };
      draw();
      startTracking();
    },
    clear,
    dispose: clear,
  };
}
