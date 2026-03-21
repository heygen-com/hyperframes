import type {
  TimelineElement,
  TimelineElementType,
  TimelineMediaElement,
  TimelineTextElement,
  TimelineCompositionElement,
  CanvasResolution,
  Keyframe,
  KeyframeProperties,
  StageZoomKeyframe,
  CompositionVariable,
} from "../core.types";
import { CANVAS_DIMENSIONS } from "../core.types";
import {
  parseGsapScript,
  validateCompositionGsap,
  gsapAnimationsToKeyframes,
  getAnimationsForElement,
} from "./gsapParser";
import type { ValidationResult } from "./gsapParser";

const MEDIA_TYPES = new Set<string>(["video", "image", "audio"]);

export interface ParsedHtml {
  elements: TimelineElement[];
  gsapScript: string | null;
  styles: string | null;
  resolution: CanvasResolution;
  keyframes: Record<string, Keyframe[]>;
  stageZoomKeyframes: StageZoomKeyframe[];
}

function getElementType(el: Element): TimelineElementType | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "video") return "video";
  if (tag === "img") return "image";
  if (tag === "audio") return "audio";
  // Check for explicit data-type attribute first
  const dataType = el.getAttribute("data-type");
  if (dataType === "composition") return "composition";
  if (dataType === "text") return "text";
  // Fall back to tag-based detection for backwards compatibility
  if (tag === "div" || tag === "p" || tag === "h1" || tag === "h2" || tag === "h3" || tag === "span") {
    return "text";
  }
  return null;
}

function getElementName(el: Element): string {
  const dataName = el.getAttribute("data-name");
  if (dataName) return dataName;

  const type = getElementType(el);
  if (type === "text") {
    const text = el.textContent?.trim().slice(0, 30) || "Text";
    return text.length === 30 ? text + "..." : text;
  }

  const src = el.getAttribute("src");
  if (src) {
    const filename = src.split("/").pop() || src;
    return filename.split("?")[0] ?? filename;
  }

  return el.id || el.className?.toString().split(" ")[0] || "Element";
}

function getZIndex(el: Element): number {
  const dataLayer = el.getAttribute("data-layer");
  if (dataLayer) return parseInt(dataLayer, 10) || 0;

  const style = (el as HTMLElement).style?.zIndex;
  if (style) return parseInt(style, 10) || 0;

  return 0;
}

function parseResolutionFromCss(doc: Document, cssText: string | null): CanvasResolution {
  const stage = doc.getElementById("stage") || doc.querySelector("#stage");
  if (stage) {
    const inlineStyle = (stage as HTMLElement).style;
    if (inlineStyle?.width && inlineStyle?.height) {
      const w = parseInt(inlineStyle.width, 10);
      const h = parseInt(inlineStyle.height, 10);
      if (w && h) {
        return w > h ? "landscape" : "portrait";
      }
    }
  }

  if (cssText) {
    const stageMatch = cssText.match(/#stage\s*\{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px[^}]*\}/);
    if (stageMatch) {
      const w = parseInt(stageMatch[1] ?? "", 10);
      const h = parseInt(stageMatch[2] ?? "", 10);
      return w > h ? "landscape" : "portrait";
    }
    const stageMatchReverse = cssText.match(/#stage\s*\{[^}]*height:\s*(\d+)px[^}]*width:\s*(\d+)px[^}]*\}/);
    if (stageMatchReverse) {
      const h = parseInt(stageMatchReverse[1] ?? "", 10);
      const w = parseInt(stageMatchReverse[2] ?? "", 10);
      return w > h ? "landscape" : "portrait";
    }
  }

  return "portrait";
}

function parseResolutionFromHtml(doc: Document): CanvasResolution | null {
  const htmlEl = doc.documentElement;
  const resolutionAttr = htmlEl.getAttribute("data-resolution");
  if (resolutionAttr === "landscape" || resolutionAttr === "portrait") {
    return resolutionAttr;
  }

  const widthAttr = htmlEl.getAttribute("data-composition-width");
  const heightAttr = htmlEl.getAttribute("data-composition-height");
  if (widthAttr && heightAttr) {
    const width = parseInt(widthAttr, 10);
    const height = parseInt(heightAttr, 10);
    if (width && height) {
      return width > height ? "landscape" : "portrait";
    }
  }

  return null;
}

export function parseHtml(html: string): ParsedHtml {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const elements: TimelineElement[] = [];
  const keyframes: Record<string, Keyframe[]> = {};
  let idCounter = 0;

  const htmlEl = doc.documentElement;
  const customStylesAttr = htmlEl.getAttribute("data-custom-styles");
  let customStyles: string | null = null;
  if (customStylesAttr) {
    try {
      customStyles = JSON.parse(customStylesAttr);
    } catch {
      customStyles = customStylesAttr;
    }
  }

  const timedElements = doc.querySelectorAll("[data-start]");

  timedElements.forEach((el) => {
    const type = getElementType(el);
    if (!type) return;

    const start = parseFloat(el.getAttribute("data-start") || "0");
    const dataEnd = el.getAttribute("data-end");

    let duration: number;
    if (dataEnd) {
      duration = Math.max(0, parseFloat(dataEnd) - start);
    } else {
      duration = 5;
    }

    const id = el.id || `element-${++idCounter}`;
    const name = getElementName(el);
    const zIndex = getZIndex(el);

    // Parse data-keyframes attribute if present
    const keyframesAttr = el.getAttribute("data-keyframes");
    if (keyframesAttr) {
      try {
        const parsedKeyframes = JSON.parse(keyframesAttr);
        if (Array.isArray(parsedKeyframes) && parsedKeyframes.length > 0) {
          keyframes[id] = parsedKeyframes;
        }
      } catch {
        // skip invalid keyframes
      }
    }

    // Parse transform properties (x, y, scale, opacity)
    const xAttr = el.getAttribute("data-x");
    const yAttr = el.getAttribute("data-y");
    const scaleAttr = el.getAttribute("data-scale");
    const opacityAttr = el.getAttribute("data-opacity");
    const x = xAttr ? parseFloat(xAttr) : undefined;
    const y = yAttr ? parseFloat(yAttr) : undefined;
    const scale = scaleAttr ? parseFloat(scaleAttr) : undefined;
    const opacity = opacityAttr ? parseFloat(opacityAttr) : undefined;

    if (type === "text") {
      const textEl = el.firstElementChild;
      const content = textEl?.textContent || name;
      const color = el.getAttribute("data-color") || undefined;
      const fontSizeAttr = el.getAttribute("data-font-size");
      const fontSize = fontSizeAttr ? parseInt(fontSizeAttr, 10) : undefined;
      const fontWeightAttr = el.getAttribute("data-font-weight");
      const fontWeight = fontWeightAttr ? parseInt(fontWeightAttr, 10) : undefined;
      const fontFamily = el.getAttribute("data-font-family") || undefined;
      const textShadowAttr = el.getAttribute("data-text-shadow");
      const textShadow = textShadowAttr === "false" ? false : undefined;

      // Parse outline properties
      const textOutlineAttr = el.getAttribute("data-text-outline");
      const textOutline = textOutlineAttr === "true" ? true : undefined;
      const textOutlineColor = el.getAttribute("data-text-outline-color") || undefined;
      const textOutlineWidthAttr = el.getAttribute("data-text-outline-width");
      const textOutlineWidth = textOutlineWidthAttr ? parseInt(textOutlineWidthAttr, 10) : undefined;

      // Parse highlight properties
      const textHighlightAttr = el.getAttribute("data-text-highlight");
      const textHighlight = textHighlightAttr === "true" ? true : undefined;
      const textHighlightColor = el.getAttribute("data-text-highlight-color") || undefined;
      const textHighlightPaddingAttr = el.getAttribute("data-text-highlight-padding");
      const textHighlightPadding = textHighlightPaddingAttr ? parseInt(textHighlightPaddingAttr, 10) : undefined;
      const textHighlightRadiusAttr = el.getAttribute("data-text-highlight-radius");
      const textHighlightRadius = textHighlightRadiusAttr ? parseInt(textHighlightRadiusAttr, 10) : undefined;

      const textElement: TimelineTextElement = {
        id,
        type: "text",
        name,
        content,
        startTime: start,
        duration,
        zIndex,
        x,
        y,
        scale,
        opacity,
        color,
        fontSize,
        fontWeight,
        fontFamily,
        textShadow,
        textOutline,
        textOutlineColor,
        textOutlineWidth,
        textHighlight,
        textHighlightColor,
        textHighlightPadding,
        textHighlightRadius,
      };
      elements.push(textElement);
    } else if (type === "composition") {
      // Composition is a div container with iframe inside
      const iframe = el.querySelector("iframe");
      const src = iframe?.getAttribute("src") || el.getAttribute("src") || "";
      const compositionId = el.getAttribute("data-composition-id") || "";
      const sourceDurationAttr = el.getAttribute("data-source-duration");
      const sourceDuration = sourceDurationAttr ? parseFloat(sourceDurationAttr) : undefined;
      const sourceWidthAttr = el.getAttribute("data-source-width");
      const sourceWidth = sourceWidthAttr ? parseInt(sourceWidthAttr, 10) : undefined;
      const sourceHeightAttr = el.getAttribute("data-source-height");
      const sourceHeight = sourceHeightAttr ? parseInt(sourceHeightAttr, 10) : undefined;

      // Parse variable values if present
      const variableValuesAttr = el.getAttribute("data-variable-values");
      let variableValues: Record<string, string | number | boolean> | undefined;
      if (variableValuesAttr) {
        try {
          variableValues = JSON.parse(variableValuesAttr);
        } catch {
          // skip invalid variable values
        }
      }

      const compositionElement: TimelineCompositionElement = {
        id,
        type: "composition",
        name,
        src,
        compositionId,
        startTime: start,
        duration,
        zIndex,
        x,
        y,
        scale,
        opacity,
        sourceDuration,
        sourceWidth,
        sourceHeight,
        variableValues,
      };
      elements.push(compositionElement);
    } else {
      if (!MEDIA_TYPES.has(type)) return;

      const src = el.getAttribute("src") || "";
      const mediaStartTimeAttr = el.getAttribute("data-media-start");
      const mediaStartTime = mediaStartTimeAttr ? parseFloat(mediaStartTimeAttr) : undefined;
      const sourceDurationAttr = el.getAttribute("data-source-duration");
      const sourceDuration = sourceDurationAttr ? parseFloat(sourceDurationAttr) : undefined;
      const isArollAttr = el.getAttribute("data-aroll");
      const isAroll = isArollAttr === "true" ? true : undefined;
      const volumeAttr = el.getAttribute("data-volume");
      const volume = volumeAttr ? parseFloat(volumeAttr) : undefined;
      const hasAudioAttr = el.getAttribute("data-has-audio");
      const hasAudio = hasAudioAttr === "true" ? true : undefined;

      const mediaElement: TimelineMediaElement = {
        id,
        type: type as "video" | "image" | "audio",
        name,
        src,
        startTime: start,
        duration,
        zIndex,
        x,
        y,
        scale,
        opacity,
        mediaStartTime,
        sourceDuration,
        isAroll,
        volume,
        hasAudio,
      };
      elements.push(mediaElement);
    }
  });

  const scriptTags = doc.querySelectorAll("script");
  let gsapScript: string | null = null;

  for (const script of scriptTags) {
    const src = script.getAttribute("src");
    if (src && src.includes("gsap")) continue;

    const content = script.textContent?.trim();
    if (content && (content.includes("gsap") || content.includes("timeline"))) {
      gsapScript = content;
      break;
    }
  }

  // Extract x/y positions and scale from GSAP script
  if (gsapScript) {
    const positionMap = extractPositionsFromGsap(gsapScript);
    for (const element of elements) {
      const pos = positionMap.get(element.id);
      if (pos) {
        if (pos.x !== undefined) element.x = pos.x;
        if (pos.y !== undefined) element.y = pos.y;
        if (
          pos.scale !== undefined &&
          (element.type === "video" || element.type === "image" || element.type === "composition")
        ) {
          (element as TimelineMediaElement | TimelineCompositionElement).scale = pos.scale;
        }
      }
    }
  }

  // Normalize keyframes (clamp negative time, convert absolute -> relative if detected)
  for (const element of elements) {
    const elementKeyframes = keyframes[element.id];
    if (!elementKeyframes || elementKeyframes.length === 0) continue;

    const baseX = element.x ?? 0;
    const baseY = element.y ?? 0;
    const baseScale =
      element.type === "video" || element.type === "image" || element.type === "composition"
        ? ((element as TimelineMediaElement | TimelineCompositionElement).scale ?? 1)
        : 1;

    keyframes[element.id] = normalizeKeyframes(elementKeyframes, baseX, baseY, baseScale);
  }

  const styleTags = doc.querySelectorAll("style");
  const allStyles =
    Array.from(styleTags)
      .map((s) => s.textContent?.trim())
      .filter(Boolean)
      .join("\n\n") || null;

  const customStyleTags = Array.from(styleTags).filter((s) => s.getAttribute("data-hf-custom") === "true");
  const customStylesFromTags =
    customStyleTags
      .map((s) => s.textContent?.trim())
      .filter(Boolean)
      .join("\n\n") || null;

  const styles = customStyles ?? customStylesFromTags ?? null;

  const resolution = parseResolutionFromHtml(doc) ?? parseResolutionFromCss(doc, allStyles);

  // Extract keyframes from GSAP animations for elements that don't have data-keyframes
  if (gsapScript) {
    const parsed = parseGsapScript(gsapScript);
    for (const element of elements) {
      // Only extract from GSAP if we don't have explicit data-keyframes
      if (keyframes[element.id]) continue;

      const elementAnimations = getAnimationsForElement(parsed.animations, element.id);
      if (elementAnimations.length > 0) {
        const elementKeyframes = gsapAnimationsToKeyframes(elementAnimations, element.startTime, {
          baseX: element.x ?? 0,
          baseY: element.y ?? 0,
          baseScale:
            element.type === "video" || element.type === "image" || element.type === "composition"
              ? ((element as TimelineMediaElement | TimelineCompositionElement).scale ?? 1)
              : 1,
          clampTimeToZero: true,
          skipBaseSet: true,
        });
        if (elementKeyframes.length > 0) {
          keyframes[element.id] = elementKeyframes;
        }
      }
    }
  }

  // Parse stage zoom keyframes from zoom container
  const stageZoomKeyframes = parseStageZoomKeyframes(doc);

  return {
    elements,
    gsapScript,
    styles,
    resolution,
    keyframes,
    stageZoomKeyframes,
  };
}

function parseStageZoomKeyframes(doc: Document): StageZoomKeyframe[] {
  const zoomContainer = doc.getElementById("stage-zoom-container");
  if (!zoomContainer) {
    return [];
  }

  const zoomKeyframesAttr = zoomContainer.getAttribute("data-zoom-keyframes");
  if (!zoomKeyframesAttr) {
    return [];
  }

  try {
    const parsed = JSON.parse(zoomKeyframesAttr);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (kf): kf is StageZoomKeyframe =>
          typeof kf === "object" &&
          kf !== null &&
          typeof kf.id === "string" &&
          typeof kf.time === "number" &&
          typeof kf.zoom === "object" &&
          kf.zoom !== null &&
          typeof kf.zoom.scale === "number" &&
          typeof kf.zoom.focusX === "number" &&
          typeof kf.zoom.focusY === "number",
      );
    }
  } catch {
    // skip invalid zoom keyframes
  }

  return [];
}

/**
 * Extract x/y positions and scale from GSAP set() calls at position 0
 * Returns a map of elementId -> { x, y, scale }
 */
function extractPositionsFromGsap(script: string): Map<string, { x?: number; y?: number; scale?: number }> {
  const positionMap = new Map<string, { x?: number; y?: number; scale?: number }>();

  try {
    const parsed = parseGsapScript(script);

    // Look for set() calls at position 0 with x/y/scale properties
    for (const anim of parsed.animations) {
      if (anim.method === "set" && anim.position === 0) {
        // Extract element ID from selector (e.g., "#element-1" -> "element-1")
        const selectorMatch = anim.targetSelector.match(/^#(.+)$/);
        if (!selectorMatch) continue;

        const elementId = selectorMatch[1] ?? "";
        const x = typeof anim.properties.x === "number" ? anim.properties.x : undefined;
        const y = typeof anim.properties.y === "number" ? anim.properties.y : undefined;
        const scale = typeof anim.properties.scale === "number" ? anim.properties.scale : undefined;

        // Only add to map if x, y, or scale is defined and non-default
        if ((x !== undefined && x !== 0) || (y !== undefined && y !== 0) || (scale !== undefined && scale !== 1)) {
          const existing = positionMap.get(elementId) || {};
          positionMap.set(elementId, {
            x: x !== undefined ? x : existing.x,
            y: y !== undefined ? y : existing.y,
            scale: scale !== undefined ? scale : existing.scale,
          });
        }
      }
    }
  } catch {
    // skip GSAP position parsing failure
  }

  return positionMap;
}

function normalizeKeyframes(keyframes: Keyframe[], baseX: number, baseY: number, baseScale: number): Keyframe[] {
  const timeEpsilon = 0.001;
  const valueEpsilon = 0.00001;

  const hasBaseCheck = (value: number | undefined, base: number): boolean =>
    value !== undefined && Math.abs(value - base) <= valueEpsilon && Math.abs(base) > valueEpsilon;

  const timeZeroKeyframes = keyframes.filter((kf) => Math.abs(kf.time) <= timeEpsilon);

  const treatAsAbsolute = timeZeroKeyframes.some((kf) => {
    const props = kf.properties || {};
    if (
      hasBaseCheck(props.x, baseX) ||
      hasBaseCheck(props.y, baseY) ||
      (baseScale !== 1 && hasBaseCheck(props.scale, baseScale))
    ) {
      return true;
    }
    return false;
  });

  return keyframes.map((kf) => {
    const normalizedProps: Partial<KeyframeProperties> = {};
    for (const [key, value] of Object.entries(kf.properties || {})) {
      if (typeof value !== "number") continue;
      if (treatAsAbsolute && key === "x") {
        normalizedProps.x = value - baseX;
      } else if (treatAsAbsolute && key === "y") {
        normalizedProps.y = value - baseY;
      } else if (treatAsAbsolute && key === "scale") {
        normalizedProps.scale = baseScale !== 0 ? value / baseScale : value;
      } else {
        (normalizedProps as Record<string, number>)[key] = value;
      }
    }

    return {
      ...kf,
      time: Math.max(0, kf.time),
      properties: normalizedProps,
    };
  });
}

export function updateElementInHtml(html: string, elementId: string, updates: Partial<TimelineElement>): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const el = doc.getElementById(elementId) || doc.querySelector(`[data-name="${elementId}"]`);
  if (!el) return html;

  if (updates.startTime !== undefined) {
    el.setAttribute("data-start", String(updates.startTime));
    if (el.hasAttribute("data-end") && updates.duration !== undefined) {
      el.setAttribute("data-end", String(updates.startTime + updates.duration));
    }
  }

  if (updates.duration !== undefined) {
    const start = parseFloat(el.getAttribute("data-start") || "0");
    el.setAttribute("data-end", String(start + updates.duration));
    el.removeAttribute("data-duration"); // Clean up legacy
  }

  if (updates.name !== undefined) {
    el.setAttribute("data-name", updates.name);
  }

  if (updates.zIndex !== undefined) {
    el.setAttribute("data-layer", String(updates.zIndex));
  }

  // Handle media-specific property
  if ("src" in updates && updates.src !== undefined) {
    el.setAttribute("src", updates.src);
  }

  // Handle text-specific properties
  if ("content" in updates && updates.content !== undefined) {
    const textEl = el.firstElementChild;
    if (textEl) {
      textEl.textContent = updates.content;
    }
  }

  if ("color" in updates && updates.color !== undefined) {
    el.setAttribute("data-color", updates.color);
  }

  if ("fontSize" in updates && updates.fontSize !== undefined) {
    el.setAttribute("data-font-size", String(updates.fontSize));
  }

  if ("textShadow" in updates) {
    if (updates.textShadow === false) {
      el.setAttribute("data-text-shadow", "false");
    } else {
      el.removeAttribute("data-text-shadow");
    }
  }

  // Handle volume property for audio/video
  if ("volume" in updates) {
    if (updates.volume !== undefined && updates.volume !== 1) {
      el.setAttribute("data-volume", String(updates.volume));
    } else {
      el.removeAttribute("data-volume");
    }
  }

  // Handle hasAudio property for videos
  if ("hasAudio" in updates) {
    if (updates.hasAudio === true) {
      el.setAttribute("data-has-audio", "true");
    } else {
      el.removeAttribute("data-has-audio");
    }
  }

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

export function addElementToHtml(
  html: string,
  element: Omit<TimelineElement, "id"> & { id?: string },
): { html: string; id: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Prefer zoom container, fall back to stage, then container, then body
  const container =
    doc.querySelector("#stage-zoom-container") ||
    doc.querySelector(".container") ||
    doc.querySelector("#stage") ||
    doc.body;

  const id = element.id || `element-${Date.now()}`;

  let newEl: Element;

  switch (element.type) {
    case "video": {
      const mediaEl = element as TimelineMediaElement;
      newEl = doc.createElement("video");
      newEl.setAttribute("muted", "");
      newEl.setAttribute("playsinline", "");
      if (mediaEl.src) newEl.setAttribute("src", mediaEl.src);
      if (mediaEl.volume !== undefined && mediaEl.volume !== 1) {
        newEl.setAttribute("data-volume", String(mediaEl.volume));
      }
      if (mediaEl.hasAudio) {
        newEl.setAttribute("data-has-audio", "true");
      }
      break;
    }
    case "image": {
      const mediaEl = element as TimelineMediaElement;
      newEl = doc.createElement("img");
      if (mediaEl.src) newEl.setAttribute("src", mediaEl.src);
      newEl.setAttribute("alt", element.name);
      break;
    }
    case "audio": {
      const mediaEl = element as TimelineMediaElement;
      newEl = doc.createElement("audio");
      if (mediaEl.src) newEl.setAttribute("src", mediaEl.src);
      if (mediaEl.volume !== undefined && mediaEl.volume !== 1) {
        newEl.setAttribute("data-volume", String(mediaEl.volume));
      }
      break;
    }
    case "text":
    default: {
      const textEl = element as TimelineTextElement;
      newEl = doc.createElement("div");
      const textContent = doc.createElement("div");
      textContent.textContent = textEl.content || element.name;
      newEl.appendChild(textContent);
      if (textEl.color) {
        newEl.setAttribute("data-color", textEl.color);
      }
      if (textEl.fontSize) {
        newEl.setAttribute("data-font-size", String(textEl.fontSize));
      }
      break;
    }
  }

  newEl.id = id;
  newEl.setAttribute("data-start", String(element.startTime));
  newEl.setAttribute("data-end", String(element.startTime + element.duration));
  newEl.setAttribute("data-layer", String(element.zIndex));
  newEl.setAttribute("data-name", element.name);

  container.appendChild(newEl);

  return {
    html: "<!DOCTYPE html>\n" + doc.documentElement.outerHTML,
    id,
  };
}

export function removeElementFromHtml(html: string, elementId: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const el = doc.getElementById(elementId);
  if (el) {
    el.remove();
  }

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

export interface CompositionMetadata {
  compositionId: string | null;
  compositionDuration: number | null;
  variables: CompositionVariable[];
}

export function extractCompositionMetadata(html: string): CompositionMetadata {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const htmlEl = doc.documentElement;

  const compositionId = htmlEl.getAttribute("data-composition-id");
  const durationStr = htmlEl.getAttribute("data-composition-duration");
  const compositionDuration = durationStr ? parseFloat(durationStr) : null;

  const variables = parseCompositionVariables(htmlEl);

  return {
    compositionId,
    compositionDuration: compositionDuration && isFinite(compositionDuration) ? compositionDuration : null,
    variables,
  };
}

function parseCompositionVariables(htmlEl: Element): CompositionVariable[] {
  const variablesAttr = htmlEl.getAttribute("data-composition-variables");
  if (!variablesAttr) {
    return [];
  }

  try {
    const parsed = JSON.parse(variablesAttr);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((v): v is CompositionVariable => {
      if (typeof v !== "object" || v === null) return false;
      if (typeof v.id !== "string" || typeof v.label !== "string") return false;
      if (!["string", "number", "color", "boolean", "enum"].includes(v.type)) return false;

      switch (v.type) {
        case "string":
          return typeof v.default === "string";
        case "number":
          return typeof v.default === "number";
        case "color":
          return typeof v.default === "string";
        case "boolean":
          return typeof v.default === "boolean";
        case "enum":
          return typeof v.default === "string" && Array.isArray(v.options);
        default:
          return false;
      }
    });
  } catch {
    return [];
  }
}

export function validateCompositionHtml(html: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const htmlEl = doc.documentElement;

  const compositionId = htmlEl.getAttribute("data-composition-id");
  if (!compositionId) {
    errors.push("Missing data-composition-id attribute on <html> element");
  }

  const durationStr = htmlEl.getAttribute("data-composition-duration");
  if (!durationStr) {
    errors.push("Missing data-composition-duration attribute on <html> element");
  } else {
    const duration = parseFloat(durationStr);
    if (!isFinite(duration) || duration <= 0) {
      errors.push("data-composition-duration must be a positive finite number");
    }
  }

  const stage = doc.getElementById("stage");
  if (!stage) {
    errors.push("Missing #stage element");
  }

  if (/\son\w+\s*=/i.test(html)) {
    errors.push("Inline event handlers (onclick, onload, etc.) not allowed");
  }

  if (/javascript\s*:/i.test(html)) {
    errors.push("javascript: URLs not allowed");
  }

  const scripts = doc.querySelectorAll("script");
  if (scripts.length > 2) {
    warnings.push("Multiple script tags detected - only GSAP CDN and main script expected");
  }

  const gsapScript = extractGsapScript(doc);
  if (gsapScript) {
    const gsapValidation = validateCompositionGsap(gsapScript);
    errors.push(...gsapValidation.errors);
    warnings.push(...gsapValidation.warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function extractGsapScript(doc: Document): string | null {
  const scripts = doc.querySelectorAll("script");
  for (const script of scripts) {
    const content = script.textContent || "";
    if (content.includes("gsap.timeline") || content.includes(".set(") || content.includes(".to(")) {
      return content;
    }
  }
  return null;
}

export { CANVAS_DIMENSIONS };
