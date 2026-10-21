import { SCENE_AFTER_BOOT_ATTR, SCENE_EAGER_ATTR, SCENE_PART_ATTR } from "../sceneParts";
import { fontFamilyKey } from "./afterFonts";
import { parseStrictFiniteTimingNumber } from "./playbackRate";
import { skipsHiddenImages } from "./timedClipHide";
import { createRuntimeStartTimeResolver } from "./startResolver";

/** How far ahead of the playhead a held scene's scripts run, so they finish before it shows. */
const SCENE_LEAD_SECONDS = 10;

export interface HeldScene {
  host: Element;
  start: number;
  end: number;
  scripts: Element[];
}

const held = new Map<string, HeldScene>();

const timing = (host: Element, name: string) =>
  parseStrictFiniteTimingNumber(host.getAttribute(name));

function holdable(
  host: Element | undefined,
  resolveStart: (host: Element, fallback?: number) => number,
): HeldScene | null {
  // Swaps and boot give captions their edited words; a mount would not.
  if (!host || host.querySelector(".caption-group")) return null;
  const authoredStart = timing(host, "data-start");
  const duration = timing(host, "data-duration");
  if (authoredStart == null || duration == null) return null;
  // An origin the resolver cannot place counts as 0, as the runtime places it: a root without its own data-start
  // is at 0, and an unresolved reference lands the scene near the start, so it runs at boot.
  const start = resolveStart(host);
  if (!Number.isFinite(start) || start <= SCENE_LEAD_SECONDS) return null;
  if (!host.hasAttribute(SCENE_EAGER_ATTR))
    return { host, start, end: start + duration, scripts: [] };
  if (!host.hasAttribute(SCENE_AFTER_BOOT_ATTR)) return null;
  return { host, start: -Infinity, end: Infinity, scripts: [] };
}

/** Preview only: the boot scripts, less far scenes' (run near the playhead) and eager scenes' (run
 * right after boot, in order). A known library a scene loads still runs at boot. */
export function holdFarSceneScripts(scripts: Element[]): Element[] {
  held.clear();
  if (!skipsHiddenImages()) return scripts;
  const { resolveStartForElement } = createRuntimeStartTimeResolver({
    documentRef: document,
    includeAuthoredTimingAttrs: true,
  });
  const hosts = new Map<string, Element>();
  for (const el of document.querySelectorAll(`[${SCENE_PART_ATTR}]`))
    if (el.tagName !== "SCRIPT" && el.tagName !== "STYLE")
      hosts.set(el.getAttribute(SCENE_PART_ATTR) ?? "", el);
  return scripts.filter((script) => {
    const scene = script.getAttribute(SCENE_PART_ATTR);
    if (scene == null || script.hasAttribute("src")) return true;
    const entry = held.get(scene) ?? holdable(hosts.get(scene), resolveStartForElement);
    if (!entry) return true;
    held.set(scene, entry);
    entry.scripts.push(script);
    return false;
  });
}

/** Hands over, once, every held scene the playhead at `t` is in or within the lead of. */
export function takeHeldScenesNear(t: number): HeldScene[] {
  const due: HeldScene[] = [];
  for (const [scene, entry] of held)
    if (t >= entry.start - SCENE_LEAD_SECONDS && t < entry.end) {
      held.delete(scene);
      due.push(entry);
    }
  return due;
}

/** The font families of the text the boot scripts' scenes show, or null when no scene waits. */
export function bootFontFamilies(): Set<string> | null {
  if (held.size === 0 || !document.body) return null;
  const waiting = new Set([...held.values()].map((scene) => scene.host));
  const families = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) =>
      waiting.has(node as Element) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let el = walker.nextNode() as Element | null; el; el = walker.nextNode() as Element | null)
    if ([...el.childNodes].some((node) => node.nodeType === 3 && node.textContent?.trim()))
      for (const family of getComputedStyle(el).fontFamily.split(","))
        families.add(fontFamilyKey(family));
  return families;
}
