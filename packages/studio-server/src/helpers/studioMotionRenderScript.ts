export interface StudioMotionRenderScriptOptions {
  activeCompositionPath?: string | null;
}

export const STUDIO_MOTION_PATH = ".hyperframes/studio-motion.json";

function hasStudioMotionEntries(manifestContent: string): boolean {
  try {
    const parsed = JSON.parse(manifestContent) as { motions?: unknown };
    return Array.isArray(parsed.motions) && parsed.motions.length > 0;
  } catch {
    return false;
  }
}

/**
 * Builds the render-time Studio motion runtime script, or null when no owned motion exists.
 */
export function createStudioMotionRenderBodyScript(
  manifestContent: string,
  options: StudioMotionRenderScriptOptions = {},
): string | null {
  if (!manifestContent.trim() || !hasStudioMotionEntries(manifestContent)) return null;
  return `(${studioMotionRenderRuntime.toString()})(${JSON.stringify(manifestContent)}, ${JSON.stringify(options.activeCompositionPath ?? null)});`;
}

function studioMotionRenderRuntime(
  manifestContent: string,
  activeCompositionPath: string | null,
): void {
  const STUDIO_MOTION_TIMELINE_ID = "studio-motion";
  const STUDIO_MOTION_ATTR = "data-hf-studio-motion";
  const ORIGINAL_TRANSFORM_ATTR = "data-hf-studio-motion-original-transform";
  const ORIGINAL_OPACITY_ATTR = "data-hf-studio-motion-original-opacity";
  const ORIGINAL_VISIBILITY_ATTR = "data-hf-studio-motion-original-visibility";

  const objectRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : null;

  const finiteNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  const runtimeWindow = window as Window & {
    gsap?: {
      timeline?: (vars?: Record<string, unknown>) => {
        fromTo?: (
          target: HTMLElement,
          from: Record<string, unknown>,
          to: Record<string, unknown>,
          at: number,
        ) => unknown;
        totalTime?: (time: number, suppressEvents?: boolean) => unknown;
        time?: (time: number) => unknown;
        pause?: () => unknown;
        kill?: () => unknown;
      };
      set?: (target: HTMLElement, vars: Record<string, unknown>) => unknown;
      registerPlugin?: (...plugins: unknown[]) => unknown;
    };
    CustomEase?: { create?: (id: string, data: string) => unknown };
    __player?: { getTime?: () => number };
    __timeline?: { time?: () => number };
    __timelines?: Record<
      string,
      | {
          kill?: () => unknown;
        }
      | undefined
    >;
    __hfStudioMotionApply?: () => number;
  };

  const parseMotionValues = (value: unknown): Record<string, number> | null => {
    const record = objectRecord(value);
    if (!record) return null;
    const parsed: Record<string, number> = {};
    for (const key of ["x", "y", "scale", "rotation", "opacity", "autoAlpha"]) {
      const next = finiteNumber(record[key]);
      if (next != null) parsed[key] = next;
    }
    return Object.keys(parsed).length > 0 ? parsed : null;
  };

  const parseCustomEase = (value: unknown): { id: string; data: string } | null => {
    const record = objectRecord(value);
    if (!record) return null;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const data = typeof record.data === "string" ? record.data.trim() : "";
    if (!id || !data) return null;
    return { id, data };
  };

  const parsedManifest = (() => {
    try {
      return objectRecord(JSON.parse(manifestContent));
    } catch {
      return null;
    }
  })();
  const manifestMotions = Array.isArray(parsedManifest?.motions) ? parsedManifest.motions : [];

  const sourceFileForElement = (element: HTMLElement): string => {
    let current: HTMLElement | null = element;
    while (current) {
      const sourceFile =
        current.getAttribute("data-composition-file") ??
        current.getAttribute("data-composition-src");
      if (sourceFile) return sourceFile;
      current = current.parentElement;
    }
    return activeCompositionPath ?? "index.html";
  };

  const elementMatchesSourceFile = (element: HTMLElement, sourceFile: string): boolean =>
    sourceFileForElement(element) === sourceFile;

  const isHTMLElement = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLElement;

  const querySelectorCandidates = (selector: string): HTMLElement[] => {
    const className = selector.match(/^\.([A-Za-z0-9_-]+)$/)?.[1];
    if (className) {
      return Array.from(document.getElementsByTagName("*")).filter(
        (element): element is HTMLElement =>
          isHTMLElement(element) && element.classList.contains(className),
      );
    }
    if (/^[A-Za-z][A-Za-z0-9-]*$/.test(selector)) {
      return Array.from(document.getElementsByTagName(selector)).filter(isHTMLElement);
    }
    return Array.from(document.querySelectorAll(selector)).filter(isHTMLElement);
  };

  const resolveTarget = (targetRecord: Record<string, unknown>): HTMLElement | null => {
    const sourceFile = typeof targetRecord.sourceFile === "string" ? targetRecord.sourceFile : "";
    if (!sourceFile) return null;
    const id = typeof targetRecord.id === "string" ? targetRecord.id : "";
    if (id) {
      const byId = document.getElementById(id);
      if (isHTMLElement(byId) && elementMatchesSourceFile(byId, sourceFile)) return byId;
    }
    const selector = typeof targetRecord.selector === "string" ? targetRecord.selector : "";
    if (!selector) return null;
    try {
      const selectorIndex = Math.max(0, Math.floor(finiteNumber(targetRecord.selectorIndex) ?? 0));
      return (
        querySelectorCandidates(selector).filter((element) =>
          elementMatchesSourceFile(element, sourceFile),
        )[selectorIndex] ?? null
      );
    } catch {
      return null;
    }
  };

  const restoreElement = (element: HTMLElement): void => {
    runtimeWindow.gsap?.set?.(element, { clearProps: "transform,opacity,visibility" });
    element.style.transform = element.getAttribute(ORIGINAL_TRANSFORM_ATTR) ?? "";
    element.style.opacity = element.getAttribute(ORIGINAL_OPACITY_ATTR) ?? "";
    element.style.visibility = element.getAttribute(ORIGINAL_VISIBILITY_ATTR) ?? "";
    element.removeAttribute(STUDIO_MOTION_ATTR);
    element.removeAttribute(ORIGINAL_TRANSFORM_ATTR);
    element.removeAttribute(ORIGINAL_OPACITY_ATTR);
    element.removeAttribute(ORIGINAL_VISIBILITY_ATTR);
  };

  const restoreStudioMotionElements = (): void => {
    for (const element of Array.from(document.querySelectorAll(`[${STUDIO_MOTION_ATTR}]`))) {
      if (isHTMLElement(element)) restoreElement(element);
    }
  };

  const readCurrentTime = (): number => {
    try {
      const playerTime = runtimeWindow.__player?.getTime?.();
      if (typeof playerTime === "number" && Number.isFinite(playerTime)) {
        return Math.max(0, playerTime);
      }
    } catch {
      // fall through
    }
    try {
      const timelineTime = runtimeWindow.__timeline?.time?.();
      if (typeof timelineTime === "number" && Number.isFinite(timelineTime)) {
        return Math.max(0, timelineTime);
      }
    } catch {
      // fall through
    }
    return 0;
  };

  const resolveEase = (motion: Record<string, unknown>): string => {
    const fallback =
      typeof motion.ease === "string" && motion.ease.trim() ? motion.ease.trim() : "none";
    const customEase = parseCustomEase(motion.customEase);
    const customEasePlugin = runtimeWindow.CustomEase;
    if (!customEase || typeof customEasePlugin?.create !== "function") return fallback;
    try {
      runtimeWindow.gsap?.registerPlugin?.(customEasePlugin);
      customEasePlugin.create(customEase.id, customEase.data);
      return customEase.id;
    } catch {
      return fallback;
    }
  };

  const applyManifest = (): number => {
    runtimeWindow.__timelines = runtimeWindow.__timelines ?? {};
    runtimeWindow.__timelines[STUDIO_MOTION_TIMELINE_ID]?.kill?.();
    delete runtimeWindow.__timelines[STUDIO_MOTION_TIMELINE_ID];
    restoreStudioMotionElements();
    const gsap = runtimeWindow.gsap;
    if (!gsap?.timeline || manifestMotions.length === 0) return 0;

    const timeline = gsap.timeline({ paused: true, defaults: { overwrite: "auto" } });
    let applied = 0;
    for (const motionValue of manifestMotions) {
      const motion = objectRecord(motionValue);
      if (!motion || motion.kind !== "gsap-motion") continue;
      const targetRecord = objectRecord(motion.target);
      if (!targetRecord) continue;
      const target = resolveTarget(targetRecord);
      if (!target || typeof timeline.fromTo !== "function") continue;
      const start = finiteNumber(motion.start);
      const duration = finiteNumber(motion.duration);
      if (start == null || duration == null || start < 0 || duration <= 0) continue;
      const from = parseMotionValues(motion.from);
      const to = parseMotionValues(motion.to);
      if (!from || !to) continue;
      if (!target.hasAttribute(STUDIO_MOTION_ATTR)) {
        target.setAttribute(ORIGINAL_TRANSFORM_ATTR, target.style.transform);
        target.setAttribute(ORIGINAL_OPACITY_ATTR, target.style.opacity);
        target.setAttribute(ORIGINAL_VISIBILITY_ATTR, target.style.visibility);
      }
      target.setAttribute(STUDIO_MOTION_ATTR, "true");
      timeline.fromTo(
        target,
        from,
        { ...to, duration, ease: resolveEase(motion), overwrite: "auto", immediateRender: false },
        start,
      );
      applied += 1;
    }

    if (applied === 0) {
      timeline.kill?.();
      return 0;
    }
    runtimeWindow.__timelines[STUDIO_MOTION_TIMELINE_ID] = timeline;
    timeline.pause?.();
    const currentTime = readCurrentTime();
    if (typeof timeline.totalTime === "function") timeline.totalTime(currentTime, false);
    else timeline.time?.(currentTime);
    return applied;
  };

  runtimeWindow.__hfStudioMotionApply = applyManifest;
  applyManifest();
}
