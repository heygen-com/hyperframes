import { SCENE_EAGER_ATTR, SCENE_PART_ATTR } from "../sceneParts";
import { parseStrictFiniteTimingNumber } from "./playbackRate";
import { skipsHiddenImages } from "./timedClipHide";

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

function holdable(host: Element | undefined): HeldScene | null {
  // Swaps and boot give captions their edited words; a mount would not.
  if (!host || host.hasAttribute(SCENE_EAGER_ATTR) || host.querySelector(".caption-group"))
    return null;
  const start = timing(host, "data-start");
  const duration = timing(host, "data-duration");
  if (start == null || duration == null || start <= SCENE_LEAD_SECONDS) return null;
  return { host, start, end: start + duration, scripts: [] };
}

/** Preview only: the boot scripts, less those of scenes that start past the lead, which wait for
 * the playhead to come near. A known library a scene loads still runs at boot. */
export function holdFarSceneScripts(scripts: Element[]): Element[] {
  held.clear();
  if (!skipsHiddenImages()) return scripts;
  const hosts = new Map<string, Element>();
  for (const el of document.querySelectorAll(`[${SCENE_PART_ATTR}]`))
    if (el.tagName !== "SCRIPT" && el.tagName !== "STYLE")
      hosts.set(el.getAttribute(SCENE_PART_ATTR) ?? "", el);
  return scripts.filter((script) => {
    const scene = script.getAttribute(SCENE_PART_ATTR);
    if (scene == null || script.hasAttribute("src")) return true;
    const entry = held.get(scene) ?? holdable(hosts.get(scene));
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
