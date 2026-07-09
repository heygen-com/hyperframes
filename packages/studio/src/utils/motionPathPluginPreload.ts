import { classifyAnimationRuntime } from "@hyperframes/parsers";
import { ensureMotionPathPluginLoaded } from "./gsapSoftReload";

type MotionPathPreloadWindow = Window & {
  __timelines?: Record<string, unknown>;
};

function inlineRuntimeForDocument(
  doc: Document,
): ReturnType<typeof classifyAnimationRuntime>["verdict"] {
  const scriptText = Array.from(doc.querySelectorAll<HTMLScriptElement>("script:not([src])"))
    .map((script) => script.textContent || "")
    .filter(Boolean)
    .join("\n");
  if (!scriptText.trim()) return "none";
  return classifyAnimationRuntime(`<script>${scriptText}</script>`).verdict;
}

function hasRegisteredGsapTimeline(win: MotionPathPreloadWindow): boolean {
  const timelines = win.__timelines;
  if (!timelines) return false;
  return Object.keys(timelines).some((key) => key !== "__proxied" && timelines[key] != null);
}

export function shouldPreloadMotionPathPlugin(iframe: HTMLIFrameElement | null): boolean {
  const win = iframe?.contentWindow as MotionPathPreloadWindow | null | undefined;
  const doc = iframe?.contentDocument;
  if (!win || !doc) return false;
  const runtime = inlineRuntimeForDocument(doc);
  if (runtime === "animejs") return false;
  if (runtime === "gsap" || runtime === "mixed") return true;
  return hasRegisteredGsapTimeline(win);
}

export function ensureMotionPathPluginLoadedForRuntime(iframe: HTMLIFrameElement | null): void {
  if (!shouldPreloadMotionPathPlugin(iframe)) return;
  ensureMotionPathPluginLoaded(iframe);
}
