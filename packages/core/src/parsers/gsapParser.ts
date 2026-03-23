import type { Keyframe, KeyframeProperties } from "../core.types";

export type GsapMethod = "set" | "to" | "from" | "fromTo";

export interface GsapAnimation {
  id: string;
  targetSelector: string;
  method: GsapMethod;
  position: number;
  properties: Record<string, number | string>;
  fromProperties?: Record<string, number | string>;
  duration?: number;
  ease?: string;
}

export interface ParsedGsap {
  animations: GsapAnimation[];
  timelineVar: string;
  preamble: string;
  postamble: string;
}

const GSAP_METHODS = new Set<string>(["set", "to", "from", "fromTo"]);

export const SUPPORTED_PROPS = [
  "opacity",
  "visibility",
  "x",
  "y",
  "scale",
  "scaleX",
  "scaleY",
  "rotation",
  "autoAlpha",
  "width",
  "height",
];

export const SUPPORTED_EASES = [
  "none",
  "power1.in",
  "power1.out",
  "power1.inOut",
  "power2.in",
  "power2.out",
  "power2.inOut",
  "power3.in",
  "power3.out",
  "power3.inOut",
  "power4.in",
  "power4.out",
  "power4.inOut",
  "back.in",
  "back.out",
  "back.inOut",
  "elastic.in",
  "elastic.out",
  "elastic.inOut",
  "bounce.in",
  "bounce.out",
  "bounce.inOut",
  "expo.in",
  "expo.out",
  "expo.inOut",
];

function parseObjectLiteral(str: string): Record<string, number | string> {
  const result: Record<string, number | string> = {};

  const cleaned = str.replace(/^\{|\}$/g, "").trim();
  if (!cleaned) return result;

  const propRegex = /(\w+)\s*:\s*("[^"]*"|'[^']*'|[\d.]+|[a-zA-Z_][\w.]*)/g;
  let match;

  while ((match = propRegex.exec(cleaned)) !== null) {
    const key = match[1] ?? "";
    let value: string | number = match[2] ?? "";

    if (typeof value === "string") {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else if (!isNaN(Number(value))) {
        value = Number(value);
      }
    }

    result[key] = value;
  }

  return result;
}

function findMatchingBrace(str: string, startIndex: number): number {
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === "{") depth++;
    else if (str[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function parseGsapScript(script: string): ParsedGsap {
  const animations: GsapAnimation[] = [];
  let idCounter = 0;

  const timelineMatch = script.match(/(?:const|let|var)\s+(\w+)\s*=\s*gsap\.timeline/);
  const timelineVar = timelineMatch ? (timelineMatch[1] ?? "tl") : "tl";

  const preambleMatch = script.match(
    new RegExp(
      `^[\\s\\S]*?(?:const|let|var)\\s+${timelineVar}\\s*=\\s*gsap\\.timeline\\s*\\([^)]*\\)\\s*;?`,
    ),
  );
  const preamble = preambleMatch
    ? preambleMatch[0]
    : `const ${timelineVar} = gsap.timeline({ paused: true });`;

  const methodPattern = new RegExp(
    `${timelineVar}\\.(set|to|from|fromTo)\\s*\\(([^)]+(?:\\{[^}]*\\}[^)]*)+)\\)`,
    "g",
  );

  let match;
  while ((match = methodPattern.exec(script)) !== null) {
    const rawMethod = match[1];
    if (!rawMethod || !GSAP_METHODS.has(rawMethod)) continue;
    const method: GsapMethod = rawMethod as GsapMethod;
    const argsStr = match[2] ?? "";

    const animation = parseGsapCall(method, argsStr, ++idCounter);
    if (animation) {
      animations.push(animation);
    }
  }

  const lastAnimIdx = script.lastIndexOf(`${timelineVar}.`);
  let postamble = "";
  if (lastAnimIdx !== -1) {
    const afterLastAnim = script.slice(lastAnimIdx);
    const endOfCall = afterLastAnim.indexOf(";");
    if (endOfCall !== -1) {
      postamble = script.slice(lastAnimIdx + endOfCall + 1).trim();
    }
  }

  return { animations, timelineVar, preamble, postamble };
}

function parseGsapCall(method: GsapMethod, argsStr: string, idNum: number): GsapAnimation | null {
  const selectorMatch = argsStr.match(/^\s*["']([^"']+)["']\s*,/);
  if (!selectorMatch) return null;

  const targetSelector = selectorMatch[1] ?? "";
  const afterSelector = argsStr.slice(selectorMatch[0].length);

  let properties: Record<string, number | string> = {};
  let fromProperties: Record<string, number | string> | undefined;
  let position = 0;

  if (method === "fromTo") {
    const firstBrace = afterSelector.indexOf("{");
    const firstEnd = findMatchingBrace(afterSelector, firstBrace);
    if (firstBrace === -1 || firstEnd === -1) return null;

    fromProperties = parseObjectLiteral(afterSelector.slice(firstBrace, firstEnd + 1));

    const secondPart = afterSelector.slice(firstEnd + 1);
    const secondBrace = secondPart.indexOf("{");
    const secondEnd = findMatchingBrace(secondPart, secondBrace);
    if (secondBrace === -1 || secondEnd === -1) return null;

    properties = parseObjectLiteral(secondPart.slice(secondBrace, secondEnd + 1));

    const afterProps = secondPart.slice(secondEnd + 1);
    const posMatch = afterProps.match(/,\s*([\d.]+)/);
    if (posMatch) position = parseFloat(posMatch[1] ?? "");
  } else {
    const braceStart = afterSelector.indexOf("{");
    const braceEnd = findMatchingBrace(afterSelector, braceStart);

    if (braceStart !== -1 && braceEnd !== -1) {
      properties = parseObjectLiteral(afterSelector.slice(braceStart, braceEnd + 1));

      const afterProps = afterSelector.slice(braceEnd + 1);
      const posMatch = afterProps.match(/,\s*([\d.]+)/);
      if (posMatch) position = parseFloat(posMatch[1] ?? "");
    }
  }

  const duration = typeof properties.duration === "number" ? properties.duration : undefined;
  const ease = typeof properties.ease === "string" ? properties.ease : undefined;

  const filteredProps: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (SUPPORTED_PROPS.includes(key)) {
      filteredProps[key] = value;
    }
  }

  let filteredFromProps: Record<string, number | string> | undefined;
  if (fromProperties) {
    filteredFromProps = {};
    for (const [key, value] of Object.entries(fromProperties)) {
      if (SUPPORTED_PROPS.includes(key)) {
        filteredFromProps[key] = value;
      }
    }
  }

  return {
    id: `anim-${idNum}`,
    targetSelector,
    method,
    position,
    properties: filteredProps,
    fromProperties: filteredFromProps,
    duration,
    ease,
  };
}

export function serializeGsapAnimations(
  animations: GsapAnimation[],
  timelineVar = "tl",
  options?: { includeMediaSync?: boolean },
): string {
  const sorted = [...animations].sort((a, b) => a.position - b.position);

  const lines = sorted.map((anim) => {
    const selector = `"${anim.targetSelector}"`;

    const props: Record<string, number | string> = { ...anim.properties };
    if (anim.duration !== undefined) props.duration = anim.duration;
    if (anim.ease) props.ease = anim.ease;

    const propsStr = serializeObject(props);

    switch (anim.method) {
      case "set":
        return `    ${timelineVar}.set(${selector}, ${propsStr}, ${anim.position});`;
      case "to":
        return `    ${timelineVar}.to(${selector}, ${propsStr}, ${anim.position});`;
      case "from":
        return `    ${timelineVar}.from(${selector}, ${propsStr}, ${anim.position});`;
      case "fromTo": {
        const fromStr = serializeObject(anim.fromProperties || {});
        return `    ${timelineVar}.fromTo(${selector}, ${fromStr}, ${propsStr}, ${anim.position});`;
      }
    }
  });

  let mediaSync = "";
  if (options?.includeMediaSync) {
    mediaSync = `
    // Sync media playback
    ${timelineVar}.eventCallback("onUpdate", function() {
      const time = ${timelineVar}.time();
      document.querySelectorAll("video[data-start], audio[data-start]").forEach(function(media) {
        const start = parseFloat(media.dataset.start);
        const end = parseFloat(media.dataset.end) || Infinity;
        const mediaTime = time - start;
        if (time >= start && time < end) {
          if (Math.abs(media.currentTime - mediaTime) > 0.1) {
            media.currentTime = mediaTime;
          }
          if (media.paused && !${timelineVar}.paused()) {
            media.play().catch(function() {});
          }
        } else if (!media.paused) {
          media.pause();
        }
      });
    });`;
  }

  return `
    const ${timelineVar} = gsap.timeline({ paused: true });
${lines.join("\n")}${mediaSync}
  `;
}

function serializeObject(obj: Record<string, number | string>): string {
  const entries = Object.entries(obj).map(([key, value]) => {
    if (typeof value === "string") {
      return `${key}: "${value}"`;
    }
    return `${key}: ${value}`;
  });
  return `{ ${entries.join(", ")} }`;
}

export function updateAnimationInScript(
  script: string,
  animationId: string,
  updates: Partial<GsapAnimation>,
): string {
  const parsed = parseGsapScript(script);

  const updated = parsed.animations.map((anim) => {
    if (anim.id === animationId) {
      return { ...anim, ...updates };
    }
    return anim;
  });

  return serializeGsapAnimations(updated, parsed.timelineVar);
}

export function addAnimationToScript(
  script: string,
  animation: Omit<GsapAnimation, "id">,
): { script: string; id: string } {
  const parsed = parseGsapScript(script);

  const id = `anim-${Date.now()}`;
  const newAnim: GsapAnimation = { ...animation, id };

  parsed.animations.push(newAnim);

  return {
    script: serializeGsapAnimations(parsed.animations, parsed.timelineVar),
    id,
  };
}

export function removeAnimationFromScript(script: string, animationId: string): string {
  const parsed = parseGsapScript(script);
  const filtered = parsed.animations.filter((a) => a.id !== animationId);
  return serializeGsapAnimations(filtered, parsed.timelineVar);
}

export function getAnimationsForElement(
  animations: GsapAnimation[],
  elementId: string,
): GsapAnimation[] {
  const selector = `#${elementId}`;
  return animations.filter((a) => a.targetSelector === selector);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const FORBIDDEN_GSAP_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\.call\s*\(/, message: "call() method not allowed" },
  {
    pattern: /\.add\s*\(\s*function/,
    message: "add(function) not allowed",
  },
  {
    pattern: /\.add\s*\(\s*\(/,
    message: "add() with arrow function not allowed",
  },
  { pattern: /onComplete\s*:/, message: "onComplete callback not allowed" },
  { pattern: /onStart\s*:/, message: "onStart callback not allowed" },
  { pattern: /onUpdate\s*:/, message: "onUpdate callback not allowed" },
  {
    pattern: /onRepeat\s*:/,
    message: "onRepeat callback not allowed",
  },
  {
    pattern: /onReverseComplete\s*:/,
    message: "onReverseComplete callback not allowed",
  },
  {
    pattern: /repeat\s*:\s*-1/,
    message: "Infinite repeat (repeat: -1) not allowed",
  },
  {
    pattern: /Math\.random\s*\(/,
    message: "Random values (Math.random) not allowed",
  },
  {
    pattern: /Date\.now\s*\(/,
    message: "Date-dependent values (Date.now) not allowed",
  },
  { pattern: /new\s+Date\s*\(/, message: "Date constructor not allowed" },
  { pattern: /setTimeout\s*\(/, message: "setTimeout not allowed" },
  { pattern: /setInterval\s*\(/, message: "setInterval not allowed" },
  {
    pattern: /requestAnimationFrame\s*\(/,
    message: "requestAnimationFrame not allowed",
  },
];

export function validateCompositionGsap(script: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { pattern, message } of FORBIDDEN_GSAP_PATTERNS) {
    if (pattern.test(script)) {
      errors.push(message);
    }
  }

  if (/yoyo\s*:\s*true/.test(script)) {
    warnings.push("yoyo animations may behave unexpectedly when scrubbing");
  }

  if (/stagger\s*:/.test(script)) {
    warnings.push("stagger animations may not serialize correctly");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function keyframesToGsapAnimations(
  elementId: string,
  keyframes: Keyframe[],
  elementStartTime: number,
  base?: { x?: number; y?: number; scale?: number },
): GsapAnimation[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const animations: GsapAnimation[] = [];
  const baseX = base?.x ?? 0;
  const baseY = base?.y ?? 0;
  const baseScale = base?.scale ?? 1;

  sorted.forEach((kf, i) => {
    const absoluteTime = elementStartTime + kf.time;
    const isFirst = i === 0;

    const prevKf = i > 0 ? sorted[i - 1] : null;
    const duration = prevKf ? kf.time - prevKf.time : undefined;
    const position = prevKf ? elementStartTime + prevKf.time : absoluteTime;

    const properties: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(kf.properties)) {
      if (typeof value !== "number") continue;
      if (key === "x") properties.x = baseX + value;
      else if (key === "y") properties.y = baseY + value;
      else if (key === "scale") properties.scale = baseScale * value;
      else properties[key] = value;
    }

    animations.push({
      id: `${elementId}-kf-${kf.id}`,
      targetSelector: `#${elementId}`,
      method: isFirst ? "set" : "to",
      position,
      properties,
      duration: isFirst ? undefined : duration,
      ease: kf.ease,
    });
  });

  return animations;
}

export function gsapAnimationsToKeyframes(
  animations: GsapAnimation[],
  elementStartTime: number,
  options?: {
    baseX?: number;
    baseY?: number;
    baseScale?: number;
    clampTimeToZero?: boolean;
    skipBaseSet?: boolean;
  },
): Keyframe[] {
  const validMethods: GsapMethod[] = ["set", "to", "from", "fromTo"];
  const baseX = options?.baseX ?? 0;
  const baseY = options?.baseY ?? 0;
  const baseScale = options?.baseScale ?? 1;
  const clampTimeToZero = options?.clampTimeToZero ?? true;
  const skipBaseSet = options?.skipBaseSet ?? false;
  const baseTimeEpsilon = 0.001;
  const baseValueEpsilon = 0.00001;

  return animations
    .filter((a) => validMethods.includes(a.method))
    .map((a) => {
      const relativeTimeRaw = a.position - elementStartTime;
      const time = clampTimeToZero ? Math.max(0, relativeTimeRaw) : relativeTimeRaw;

      const properties: Partial<KeyframeProperties> = {};

      for (const [key, value] of Object.entries(a.properties)) {
        if (SUPPORTED_PROPS.includes(key) && typeof value === "number") {
          if (key === "x") {
            (properties as Record<string, number>).x = value - baseX;
          } else if (key === "y") {
            (properties as Record<string, number>).y = value - baseY;
          } else if (key === "scale") {
            (properties as Record<string, number>).scale =
              baseScale !== 0 ? value / baseScale : value;
          } else {
            (properties as Record<string, number>)[key] = value;
          }
        }
      }

      if (skipBaseSet && a.method === "set" && Math.abs(time) <= baseTimeEpsilon) {
        const propKeys = Object.keys(properties);
        const isOnlyBaseProps = propKeys.every((k) => k === "x" || k === "y" || k === "scale");
        if (isOnlyBaseProps && propKeys.length > 0) {
          const hasNonBaseOffset =
            (properties.x !== undefined && Math.abs(properties.x) > baseValueEpsilon) ||
            (properties.y !== undefined && Math.abs(properties.y) > baseValueEpsilon) ||
            (properties.scale !== undefined && Math.abs(properties.scale - 1) > baseValueEpsilon);
          if (!hasNonBaseOffset) {
            return null;
          }
        }
      }

      const kf: Keyframe = { id: a.id, time, properties };
      if (a.ease !== undefined) kf.ease = a.ease;
      return kf;
    })
    .filter((kf): kf is Keyframe => kf !== null)
    .sort((a, b) => a.time - b.time);
}
