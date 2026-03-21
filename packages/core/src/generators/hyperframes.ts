import type {
  TimelineElement,
  CanvasResolution,
  Keyframe,
  StageZoomKeyframe,
} from "../core.types";
import {
  CANVAS_DIMENSIONS,
  isTextElement,
  isMediaElement,
  isCompositionElement,
} from "../core.types";
import type { GsapAnimation } from "../parsers/gsapParser";
import { serializeGsapAnimations, keyframesToGsapAnimations } from "../parsers/gsapParser";
import { GSAP_CDN, BASE_STYLES, ZOOM_CONTAINER_STYLES } from "../templates/constants";

const GOOGLE_FONTS_BASE = "https://fonts.googleapis.com/css2";
const FONT_WEIGHTS: Record<string, string> = {
  Inter: "400;500;600;700;800;900",
  Roboto: "400;500;700;900",
  Montserrat: "400;500;600;700;800;900",
  Poppins: "400;500;600;700;800;900",
  "Bebas Neue": "400",
  Oswald: "400;500;600;700",
  Anton: "400",
  "Playfair Display": "400;500;600;700;800;900",
  Lora: "400;500;600;700",
  Pacifico: "400",
  "Permanent Marker": "400",
  "Fira Code": "400;500;600;700",
};

function generateGoogleFontsUrl(fontFamilies: string[]): string | null {
  if (fontFamilies.length === 0) return null;

  const families = fontFamilies
    .filter((f) => f in FONT_WEIGHTS)
    .map((f) => {
      const weights = FONT_WEIGHTS[f];
      const encodedName = f.replace(/ /g, "+");
      return `family=${encodedName}:wght@${weights}`;
    });

  if (families.length === 0) return null;
  return `${GOOGLE_FONTS_BASE}?${families.join("&")}&display=swap`;
}

export interface SerializeOptions {
  animations?: GsapAnimation[];
  styles?: string;
  generateDefaultAnimations?: boolean;
  resolution?: CanvasResolution;
  compositionId?: string;
  keyframes?: Record<string, Keyframe[]>;
  stageZoomKeyframes?: StageZoomKeyframe[];
  includeScripts?: boolean;
  includeStyles?: boolean;
}

/**
 * Stage Positioning Conventions:
 *
 * 1. All elements are absolutely positioned relative to the #stage container
 * 2. The #stage has position: relative and fixed dimensions (1920x1080 or 1080x1920)
 * 3. Elements start with opacity: 0 and are revealed via GSAP animations
 *
 * Media Elements (video, image):
 * - position: absolute (relative to #stage)
 * - width: 100%, height: 100% (fill the stage)
 * - object-fit: contain (preserve aspect ratio, centered, no cropping)
 * - This ensures media is always visible and centered within the stage
 *
 * Text Elements:
 * - position: absolute, width/height: 100%
 * - Inner div uses flexbox to center content (selected via > div)
 *
 * Audio Elements:
 * - position: absolute (invisible, for timing only)
 */
function sortElements(elements: TimelineElement[]): TimelineElement[] {
  return [...elements].sort((a, b) => {
    if (a.zIndex !== b.zIndex) {
      return (a.zIndex ?? 0) - (b.zIndex ?? 0);
    }
    return a.startTime - b.startTime;
  });
}

export function generateHyperframesStyles(
  elements: TimelineElement[],
  resolution: CanvasResolution,
  customStyles?: string,
): { coreCss: string; customCss: string; googleFontsLink: string } {
  const { width, height } = CANVAS_DIMENSIONS[resolution];
  const sortedElements = sortElements(elements);
  const elementStyles = sortedElements.map((el) => generateElementStyles(el)).join("\n");

  // Collect unique font families from text elements
  const usedFonts = new Set<string>();
  for (const el of sortedElements) {
    if (isTextElement(el) && el.fontFamily) {
      usedFonts.add(el.fontFamily);
    }
  }
  // Always include Inter as the default
  usedFonts.add("Inter");
  const googleFontsUrl = generateGoogleFontsUrl([...usedFonts]);

  const googleFontsLink = googleFontsUrl
    ? `<link data-hf-fonts="true" rel="preconnect" href="https://fonts.googleapis.com">
  <link data-hf-fonts="true" rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link data-hf-fonts="true" href="${googleFontsUrl}" rel="stylesheet">`
    : "";

  const coreCss = `${BASE_STYLES}
#stage { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; background: #fff; }
#stage-zoom-container { ${ZOOM_CONTAINER_STYLES} }
${elementStyles}`.trim();

  const customCss = customStyles?.trim() ? customStyles.trim() : "";

  return { coreCss, customCss, googleFontsLink };
}

function generateElementStyles(element: TimelineElement): string {
  const baseStyles = "position: absolute;";

  if (isTextElement(element)) {
    const fontSize = element.fontSize ?? 48;
    const fontWeight = element.fontWeight ?? 700;
    const fontFamily = element.fontFamily ?? "Inter";
    const color = element.color ?? "white";
    const textShadow = element.textShadow !== false ? "text-shadow: 2px 2px 4px rgba(0,0,0,0.8);" : "";

    // Text outline using -webkit-text-stroke
    const textOutline = element.textOutline
      ? `-webkit-text-stroke: ${element.textOutlineWidth ?? 2}px ${
          element.textOutlineColor ?? "#000000"
        }; paint-order: stroke fill;`
      : "";

    // Text highlight using background
    const textHighlight = element.textHighlight
      ? `background-color: ${element.textHighlightColor ?? "yellow"}; padding: ${element.textHighlightPadding ?? 4}px ${
          (element.textHighlightPadding ?? 4) * 1.5
        }px; border-radius: ${
          element.textHighlightRadius ?? 4
        }px; box-decoration-break: clone; -webkit-box-decoration-break: clone;`
      : "";

    return `    #${element.id} { ${baseStyles} width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; pointer-events: none; }
    #${element.id} > div { font-family: '${fontFamily}', sans-serif; font-size: ${fontSize}px; font-weight: ${fontWeight}; color: ${color}; ${textShadow} ${textOutline} ${textHighlight} pointer-events: auto; cursor: grab; white-space: pre-wrap; text-align: center; }`;
  }

  switch (element.type) {
    case "video":
      // Videos fill the stage with standard CSS positioning (0,0 = top-left)
      return `    #${element.id} { ${baseStyles} width: 100%; height: 100%; object-fit: contain; transform-origin: center center; }`;
    case "image":
      // Images use standard CSS positioning (0,0 = top-left)
      return `    #${element.id} { ${baseStyles} max-width: 100%; max-height: 100%; transform-origin: center center; }`;
    case "audio":
      return `    #${element.id} { ${baseStyles} }`;
    case "composition":
      // Compositions use standard CSS positioning (0,0 = top-left)
      return `    #${element.id} { ${baseStyles} width: 100%; height: 100%; position: absolute; }`;
  }
}

export function generateGsapTimelineScript(
  elements: TimelineElement[],
  totalDuration: number,
  options: SerializeOptions = {},
): string {
  const {
    animations,
    generateDefaultAnimations = true,
    resolution = "landscape",
    keyframes,
    stageZoomKeyframes,
  } = options;

  const { width, height } = CANVAS_DIMENSIONS[resolution];
  const sortedElements = sortElements(elements);

  const hasMedia = sortedElements.some((el) => el.type === "video" || el.type === "audio");

  // Convert keyframes to GSAP animations
  let keyframeAnimations: GsapAnimation[] = [];
  if (keyframes) {
    for (const element of sortedElements) {
      const elementKeyframes = keyframes[element.id];
      if (elementKeyframes && elementKeyframes.length > 0) {
        const baseScale = isMediaElement(element) || isCompositionElement(element) ? (element.scale ?? 1) : 1;
        const converted = keyframesToGsapAnimations(element.id, elementKeyframes, element.startTime, {
          x: element.x ?? 0,
          y: element.y ?? 0,
          scale: baseScale,
        });
        keyframeAnimations = keyframeAnimations.concat(converted);
      }
    }
  }

  // Generate zoom keyframes GSAP animations
  const zoomAnimations = generateZoomGsapAnimations(stageZoomKeyframes || [], width, height);

  // Generate initial position/scale set() calls for all elements
  // This must be included regardless of keyframe animations
  const initialPositionSets = generateInitialPositionSets(sortedElements, keyframes);

  // Generate visibility animations for elements without keyframes
  // When using keyframes path, elements without keyframes need explicit visibility
  const visibilityAnimations = generateVisibilityForElementsWithoutKeyframes(sortedElements, keyframes);

  let gsapScript: string;
  if (animations && animations.length > 0) {
    // Merge provided animations with keyframe animations
    const allAnimations = [...animations, ...keyframeAnimations];
    gsapScript = serializeGsapAnimations(allAnimations, "tl", {
      includeMediaSync: hasMedia,
    });
    // Prepend initial positions and visibility for elements without keyframes, append zoom animations
    const prependAnimations = [initialPositionSets, visibilityAnimations].filter(Boolean).join("\n");
    if (prependAnimations) {
      gsapScript = gsapScript.replace(
        "const tl = gsap.timeline({ paused: true });",
        `const tl = gsap.timeline({ paused: true });\n${prependAnimations}`,
      );
    }
    if (zoomAnimations) {
      gsapScript += "\n" + zoomAnimations;
    }
  } else if (keyframeAnimations.length > 0) {
    // Use only keyframe animations
    gsapScript = serializeGsapAnimations(keyframeAnimations, "tl", {
      includeMediaSync: hasMedia,
    });
    // Prepend initial positions and visibility for elements without keyframes, append zoom animations
    const prependAnimations = [initialPositionSets, visibilityAnimations].filter(Boolean).join("\n");
    if (prependAnimations) {
      gsapScript = gsapScript.replace(
        "const tl = gsap.timeline({ paused: true });",
        `const tl = gsap.timeline({ paused: true });\n${prependAnimations}`,
      );
    }
    if (zoomAnimations) {
      gsapScript += "\n" + zoomAnimations;
    }
  } else if (generateDefaultAnimations) {
    gsapScript = generateDefaultGsapAnimations(sortedElements, totalDuration, stageZoomKeyframes, width, height);
  } else {
    gsapScript = `
    const tl = gsap.timeline({ paused: true });
${initialPositionSets ? initialPositionSets + "\n" : ""}    tl.to({}, { duration: ${totalDuration || 1} });
    `;
    // Append zoom animations
    if (zoomAnimations) {
      gsapScript += "\n" + zoomAnimations;
    }
  }

  return gsapScript;
}

export function generateHyperframesHtml(
  elements: TimelineElement[],
  totalDuration: number,
  options: SerializeOptions = {},
): string {
  const {
    animations,
    styles,
    generateDefaultAnimations = true,
    resolution = "landscape",
    compositionId = `comp-${Date.now()}`,
    keyframes,
    stageZoomKeyframes,
    includeScripts = false,
    includeStyles = false,
  } = options;

  const { width, height } = CANVAS_DIMENSIONS[resolution];
  // Include zoom keyframes in duration calculation
  const maxZoomTime =
    stageZoomKeyframes && stageZoomKeyframes.length > 0 ? Math.max(...stageZoomKeyframes.map((kf) => kf.time)) : 0;

  const calculatedDuration =
    elements.length > 0
      ? Math.max(...elements.map((el) => el.startTime + el.duration), totalDuration, maxZoomTime)
      : Math.max(totalDuration, maxZoomTime);

  const sortedElements = sortElements(elements);

  const elementsHtml = sortedElements.map((el) => generateElementHtml(el, keyframes?.[el.id])).join("\n      ");

  const customStyles = styles || "";

  // Serialize zoom keyframes to data attribute
  const zoomKeyframesAttr =
    stageZoomKeyframes && stageZoomKeyframes.length > 0
      ? ` data-zoom-keyframes='${JSON.stringify(stageZoomKeyframes).replace(/'/g, "&#39;")}'`
      : "";

  const { coreCss, customCss, googleFontsLink } = generateHyperframesStyles(sortedElements, resolution, customStyles);

  const gsapScript = includeScripts
    ? generateGsapTimelineScript(sortedElements, totalDuration, {
        animations,
        generateDefaultAnimations,
        resolution,
        keyframes,
        stageZoomKeyframes,
      })
    : "";

  const gsapCdnTag = includeScripts ? `  <script src="${GSAP_CDN}"></script>` : "";

  const gsapScriptTag = includeScripts
    ? `  <script>
${gsapScript}
  </script>`
    : "";

  const styleTags = includeStyles
    ? [
        coreCss
          ? `  <style data-hf-core="true">
    ${coreCss.split("\n").join("\n    ")}
  </style>`
          : "",
        customCss
          ? `  <style data-hf-custom="true">
    ${customCss.split("\n").join("\n    ")}
  </style>`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const customStylesAttr = customStyles
    ? ` data-custom-styles='${JSON.stringify(customStyles).replace(/'/g, "&#39;")}'`
    : "";

  const resolutionAttr = ` data-resolution="${resolution}"`;

  return `<!DOCTYPE html>
<html data-composition-id="${compositionId}" data-composition-duration="${calculatedDuration}"${resolutionAttr}${customStylesAttr}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${includeStyles ? googleFontsLink : ""}
  ${gsapCdnTag}
${styleTags ? `  ${styleTags}` : ""}
</head>
<body>
  <div id="stage">
    <div id="stage-zoom-container"${zoomKeyframesAttr}>
      ${elementsHtml}
    </div>
  </div>
  ${gsapScriptTag}
</body>
</html>`;
}

function calculateZoomTransform(
  scale: number,
  focusX: number,
  focusY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  const x = centerX - focusX * scale;
  const y = centerY - focusY * scale;
  return { x, y };
}

function generateZoomGsapAnimations(
  zoomKeyframes: StageZoomKeyframe[],
  canvasWidth: number,
  canvasHeight: number,
): string {
  if (!zoomKeyframes || zoomKeyframes.length === 0) {
    return "";
  }

  const sortedKeyframes = [...zoomKeyframes].sort((a, b) => a.time - b.time);
  const animations: string[] = [];

  animations.push("    // Stage zoom animations");

  for (let i = 0; i < sortedKeyframes.length; i++) {
    const kf = sortedKeyframes[i];
    if (!kf) continue;
    const { x, y } = calculateZoomTransform(
      kf.zoom.scale,
      kf.zoom.focusX,
      kf.zoom.focusY,
      canvasWidth,
      canvasHeight,
    );

    if (i === 0) {
      animations.push(
        `    tl.set("#stage-zoom-container", { scale: ${kf.zoom.scale}, x: ${x}, y: ${y} }, ${kf.time});`,
      );
    } else {
      const prevKf = sortedKeyframes[i - 1];
      if (!prevKf) continue;
      const duration = kf.time - prevKf.time;
      const ease = kf.ease ? `, ease: "${kf.ease}"` : "";
      animations.push(
        `    tl.to("#stage-zoom-container", { scale: ${kf.zoom.scale}, x: ${x}, y: ${y}, duration: ${duration}${ease} }, ${prevKf.time});`,
      );
    }
  }

  return animations.join("\n");
}

function generateElementHtml(element: TimelineElement, keyframes?: Keyframe[]): string {
  const baseAttrs = [
    `id="${element.id}"`,
    `data-start="${element.startTime}"`,
    `data-end="${element.startTime + element.duration}"`,
    `data-layer="${element.zIndex}"`,
    `data-name="${element.name}"`,
  ];

  // Serialize transform properties (x, y, scale, opacity) if non-default
  if (element.x !== undefined && element.x !== 0) {
    baseAttrs.push(`data-x="${element.x}"`);
  }
  if (element.y !== undefined && element.y !== 0) {
    baseAttrs.push(`data-y="${element.y}"`);
  }
  if (element.scale !== undefined && element.scale !== 1) {
    baseAttrs.push(`data-scale="${element.scale}"`);
  }
  if (element.opacity !== undefined && element.opacity !== 1) {
    baseAttrs.push(`data-opacity="${element.opacity}"`);
  }

  // Serialize keyframes to data attribute if present
  if (keyframes && keyframes.length > 0) {
    const kfJson = JSON.stringify(keyframes);
    baseAttrs.push(`data-keyframes='${kfJson.replace(/'/g, "&#39;")}'`);
  }

  if (isTextElement(element)) {
    const textAttrs = [...baseAttrs, `data-type="text"`];
    if (element.color) {
      textAttrs.push(`data-color="${element.color}"`);
    }
    if (element.fontSize) {
      textAttrs.push(`data-font-size="${element.fontSize}"`);
    }
    if (element.fontWeight) {
      textAttrs.push(`data-font-weight="${element.fontWeight}"`);
    }
    if (element.fontFamily) {
      textAttrs.push(`data-font-family="${element.fontFamily}"`);
    }
    if (element.textShadow === false) {
      textAttrs.push(`data-text-shadow="false"`);
    }
    if (element.textOutline) {
      textAttrs.push(`data-text-outline="true"`);
      if (element.textOutlineColor) {
        textAttrs.push(`data-text-outline-color="${element.textOutlineColor}"`);
      }
      if (element.textOutlineWidth) {
        textAttrs.push(`data-text-outline-width="${element.textOutlineWidth}"`);
      }
    }
    if (element.textHighlight) {
      textAttrs.push(`data-text-highlight="true"`);
      if (element.textHighlightColor) {
        textAttrs.push(`data-text-highlight-color="${element.textHighlightColor}"`);
      }
      if (element.textHighlightPadding) {
        textAttrs.push(`data-text-highlight-padding="${element.textHighlightPadding}"`);
      }
      if (element.textHighlightRadius) {
        textAttrs.push(`data-text-highlight-radius="${element.textHighlightRadius}"`);
      }
    }
    const content = element.content || element.name;
    return `<div ${textAttrs.join(" ")}><div>${content}</div></div>`;
  }

  if (isCompositionElement(element)) {
    const compositionAttrs = [
      ...baseAttrs,
      `data-type="composition"`,
      `data-composition-id="${element.compositionId}"`,
    ];
    if (element.sourceDuration) {
      compositionAttrs.push(`data-source-duration="${element.sourceDuration}"`);
    }
    if (element.sourceWidth) {
      compositionAttrs.push(`data-source-width="${element.sourceWidth}"`);
    }
    if (element.sourceHeight) {
      compositionAttrs.push(`data-source-height="${element.sourceHeight}"`);
    }
    if (element.variableValues && Object.keys(element.variableValues).length > 0) {
      const varJson = JSON.stringify(element.variableValues);
      compositionAttrs.push(`data-variable-values='${varJson.replace(/'/g, "&#39;")}'`);
    }
    const attrs = compositionAttrs.join(" ");
    // Build iframe src with variable values as query params if present
    // Strip any existing query params first to avoid duplication
    let iframeSrc = element.src.split("?")[0];
    if (element.variableValues && Object.keys(element.variableValues).length > 0) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(element.variableValues)) {
        params.set(key, String(value));
      }
      iframeSrc = `${iframeSrc}?${params.toString()}`;
    }
    // Motion designs are full-screen overlays - always use 100% sizing
    // The motion design HTML handles its own internal positioning
    // Wrap iframe in container with click overlay for selection
    return `<div ${attrs} style="width: 100%; height: 100%;">
      <iframe src="${iframeSrc}" sandbox="allow-scripts allow-same-origin" style="width: 100%; height: 100%; border: none; pointer-events: none;"></iframe>
      <div class="composition-click-overlay" style="position: absolute; inset: 0; cursor: pointer;"></div>
    </div>`;
  }

  if (isMediaElement(element)) {
    if (element.mediaStartTime) {
      baseAttrs.push(`data-media-start="${element.mediaStartTime}"`);
    }
    if (element.sourceDuration) {
      baseAttrs.push(`data-source-duration="${element.sourceDuration}"`);
    }
    if (element.isAroll) {
      baseAttrs.push(`data-aroll="true"`);
    }
    if (element.volume !== undefined && element.volume !== 1) {
      baseAttrs.push(`data-volume="${element.volume}"`);
    }
    if (element.type === "video" && element.hasAudio) {
      baseAttrs.push(`data-has-audio="true"`);
    }
  }

  const attrs = baseAttrs.join(" ");

  switch (element.type) {
    case "video":
      return `<video ${attrs} src="${element.src}" playsinline></video>`;
    case "image":
      return `<img ${attrs} src="${element.src}" alt="${element.name}" />`;
    case "audio":
      return `<audio ${attrs} src="${element.src}"></audio>`;
    default:
      return "";
  }
}

/**
 * Generate initial position sets for elements.
 *
 * Center-based coordinate system with standard CSS origin:
 * - (0, 0) = top-left corner of the canvas
 * - (960, 540) = center of canvas (landscape 1920x1080)
 * - x/y specifies where the element's CENTER goes (not top-left corner)
 *
 * Note: xPercent: -50, yPercent: -50 is applied once at player init via
 * _initializeElementCentering(), so we only set x, y, scale here.
 * This keeps generated timeline code clean (no repeated xPercent/yPercent).
 */
function generateInitialPositionSets(elements: TimelineElement[], keyframes?: Record<string, Keyframe[]>): string {
  const sets: string[] = [];
  const timeEpsilon = 0.001;

  for (const el of elements) {
    const elementKeyframes = keyframes?.[el.id];
    const hasBaseKeyframe = elementKeyframes?.some(
      (kf) =>
        Math.abs(kf.time) <= timeEpsilon &&
        (kf.properties.x !== undefined || kf.properties.y !== undefined || kf.properties.scale !== undefined),
    );

    const xVal = el.x ?? 0;
    const yVal = el.y ?? 0;
    const scaleVal = isMediaElement(el) ? (el.scale ?? 1) : 1;

    // Audio elements don't need positioning
    if (el.type === "audio") continue;

    // Composition elements (motion designs) are full-screen overlays
    // They don't need x/y/scale positioning - the HTML handles internal layout
    if (isCompositionElement(el)) continue;

    // Skip if element has a base keyframe that will handle positioning
    if (hasBaseKeyframe) {
      continue;
    }

    // Set position and scale (xPercent/yPercent applied at player init)
    if (scaleVal !== 1) {
      sets.push(`    tl.set("#${el.id}", { x: ${xVal}, y: ${yVal}, scale: ${scaleVal} }, 0);`);
    } else if (xVal !== 0 || yVal !== 0) {
      sets.push(`    tl.set("#${el.id}", { x: ${xVal}, y: ${yVal} }, 0);`);
    }
  }

  return sets.length > 0 ? sets.join("\n") : "";
}

/**
 * Generates visibility bookends for ALL elements to ensure they appear/disappear
 * at the correct times. Elements with keyframes still need visibility bookends
 * because keyframesToGsapAnimations only handles property animations, not visibility.
 *
 * If opacity keyframes exist, the first keyframe defines the base.
 */
function generateVisibilityForElementsWithoutKeyframes(
  elements: TimelineElement[],
  keyframes?: Record<string, Keyframe[]>,
): string {
  const animations: string[] = [];

  for (const el of elements) {
    const elementKeyframes = keyframes?.[el.id];
    const opacityKeyframes = elementKeyframes?.filter((kf) => kf.properties.opacity !== undefined) || [];
    const start = el.startTime;
    const end = el.startTime + el.duration;

    const safeName = el.name.replace(/[\r\n]+/g, " ");
    animations.push(`    // ${safeName} (visibility)`);
    animations.push(`    tl.set("#${el.id}", { visibility: "hidden" }, 0);`);

    let elementOpacity = el.opacity ?? 1;
    if (opacityKeyframes.length > 0) {
      const firstOpacityKeyframe = [...opacityKeyframes].sort((a, b) => a.time - b.time)[0];
      if (firstOpacityKeyframe?.properties.opacity !== undefined) {
        elementOpacity = firstOpacityKeyframe.properties.opacity;
      }
    }
    // Only include opacity in visibility bookend if non-default or has opacity keyframes
    const needsOpacity = elementOpacity !== 1 || opacityKeyframes.length > 0;
    if (needsOpacity) {
      animations.push(`    tl.set("#${el.id}", { visibility: "visible", opacity: ${elementOpacity} }, ${start});`);
    } else {
      animations.push(`    tl.set("#${el.id}", { visibility: "visible" }, ${start});`);
    }

    animations.push(`    tl.set("#${el.id}", { visibility: "hidden" }, ${end});`);
  }

  return animations.length > 0 ? animations.join("\n") : "";
}

function generateDefaultGsapAnimations(
  elements: TimelineElement[],
  totalDuration: number,
  stageZoomKeyframes?: StageZoomKeyframe[],
  canvasWidth?: number,
  canvasHeight?: number,
): string {
  if (elements.length === 0 && (!stageZoomKeyframes || stageZoomKeyframes.length === 0)) {
    return `
    const tl = gsap.timeline({ paused: true });
    tl.to({}, { duration: ${totalDuration || 1} });
    `;
  }

  const animations: string[] = [];

  // First, set initial positions and scales for elements with x/y offsets or scale
  const initialPositionSets = generateInitialPositionSets(elements);
  if (initialPositionSets) {
    animations.push(initialPositionSets);
  }

  for (const el of elements) {
    const start = el.startTime;
    const end = el.startTime + el.duration;

    const safeName = el.name.replace(/[\r\n]+/g, " ");
    const elementOpacity = el.opacity ?? 1;
    animations.push(`    // ${safeName}`);
    animations.push(`    tl.set("#${el.id}", { visibility: "hidden" }, 0);`);
    // Only include opacity if non-default
    if (elementOpacity !== 1) {
      animations.push(`    tl.set("#${el.id}", { visibility: "visible", opacity: ${elementOpacity} }, ${start});`);
    } else {
      animations.push(`    tl.set("#${el.id}", { visibility: "visible" }, ${start});`);
    }
    animations.push(`    tl.set("#${el.id}", { visibility: "hidden" }, ${end});`);
  }

  const mediaElements = elements.filter((el) => el.type === "video" || el.type === "audio");
  const mediaSync =
    mediaElements.length > 0
      ? `
    // Sync media playback
    tl.eventCallback("onUpdate", function() {
      const time = tl.time();
      document.querySelectorAll("video[data-start], audio[data-start]").forEach(function(media) {
        const start = parseFloat(media.dataset.start);
        const end = parseFloat(media.dataset.end) || Infinity;
        const mediaTime = time - start;
        if (time >= start && time < end) {
          if (Math.abs(media.currentTime - mediaTime) > 0.1) {
            media.currentTime = mediaTime;
          }
          if (media.paused && !tl.paused()) {
            media.play().catch(function() {});
          }
        } else if (!media.paused) {
          media.pause();
        }
      });
    });`
      : "";

  // Generate zoom animations if present
  const zoomAnimations =
    stageZoomKeyframes && stageZoomKeyframes.length > 0 && canvasWidth && canvasHeight
      ? "\n" + generateZoomGsapAnimations(stageZoomKeyframes, canvasWidth, canvasHeight)
      : "";

  return `
    const tl = gsap.timeline({ paused: true });
${animations.join("\n")}
    ${mediaSync}${zoomAnimations}
  `;
}
