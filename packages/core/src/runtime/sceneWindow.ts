import { SCENE_NO_SWAP_ATTR, SCENE_PART_ATTR, SCENE_PARTS_META } from "../sceneParts";
import { STUDIO_PREVIEW_PARKED_SCENE_ATTR as PARKED } from "../studioPreviewMark";
import { AUTHORED_DURATION_ATTR, AUTHORED_END_ATTR } from "./authoredTiming";
import { parseElementDurationAttr, type ParkedTimelineScene } from "./timeline";
import type { RuntimeTimelineClip } from "./types";

/** A scene the preview may unmount: its host's own attributes time it, and its parts can be run again. */
export type WindowedScene = { name: string; start: number; end: number };

// Each windowed scene as the page first had it, before any script ran: what a mount puts back.
const pristine = new Map<string, { html: string; scripts: Element[] }>();

const partsSelector = (name: string, tag = "") =>
  `${tag}[${SCENE_PART_ATTR}="${CSS.escape(name)}"]`;
// What the timeline reads: the runtime moves a nested host's authored length off `data-duration`.
const ownDuration = (el: Element) => parseElementDurationAttr(el) ?? 0;

/** Parked, a clip whose length only its loaded media or its own timeline gives would show to the scene's end. */
export const clipLengthsWritten = (host: Element): boolean =>
  Array.from(host.querySelectorAll("video, audio, [data-composition-id]")).every(
    (el) => ownDuration(el) > 0,
  );

// A scene of the film itself, whose script a mount may run again and whose clips keep their lengths parked.
const parkable = (host: Element): boolean => {
  const film = host.parentElement;
  return (
    !host.hasAttribute(SCENE_NO_SWAP_ATTR) &&
    !host.hasAttribute("data-hf-original-composition-id") &&
    (isParked(host) || clipLengthsWritten(host)) &&
    film?.hasAttribute("data-composition-id") === true &&
    film.closest(`[${SCENE_PART_ATTR}]`) === null
  );
};

/** A host's window when its own attributes give it in seconds; a reference start or no length gives none. */
export function ownWindow(host: Element): { start: number; end: number } | null {
  const start = Number(host.getAttribute("data-start")?.trim() || Number.NaN);
  const duration = ownDuration(host);
  return Number.isFinite(start) && duration > 0 ? { start, end: start + duration } : null;
}

function windowedHosts(): Array<WindowedScene & { host: Element }> {
  if (!document.querySelector(`meta[name="${SCENE_PARTS_META}"]`)) return [];
  return Array.from(document.querySelectorAll(`[${SCENE_PART_ATTR}]:not(style, script)`))
    .flatMap((host) => {
      const own = parkable(host) ? ownWindow(host) : null;
      return own ? [{ name: host.getAttribute(SCENE_PART_ATTR)!, host, ...own }] : [];
    })
    .sort((a, b) => a.start - b.start);
}

/** The scenes boot kept for remounting, in start order; mounted or parked, a host keeps its timing. */
export const windowedScenes = (): WindowedScene[] =>
  windowedHosts()
    .filter(({ name }) => pristine.has(name))
    .map(({ name, start, end }) => ({ name, start, end }));

// Playing, a scene mounts this long before its cut, so the cut's frames do no mount work.
const MOUNT_AHEAD_SECONDS = 10;

/** The scenes wanted mounted at `time`: the playing ones, then those starting within the lead, or paused, the next. */
export function scenesWanted(scenes: WindowedScene[], time: number, playing: boolean): Set<string> {
  const next = scenes.find((s) => s.start > time);
  const wanted = (s: WindowedScene) => {
    if (s.start <= time) return time <= s.end;
    return playing ? s.start <= time + MOUNT_AHEAD_SECONDS : s === next;
  };
  return new Set(scenes.filter(wanted).map((s) => s.name));
}

export const hostOf = (name: string): Element | null =>
  document.querySelector(`${partsSelector(name)}:not(style, script)`);

export const isParked = (host: Element): boolean => host.hasAttribute(PARKED);

/** Swaps a scene's host for an empty copy that keeps its timing, and takes its scripts out of the page. */
export function park(name: string): Element | null {
  const host = hostOf(name);
  if (!host || isParked(host)) return host;
  for (const script of document.querySelectorAll(partsSelector(name, "script"))) script.remove();
  const placeholder = host.cloneNode(false) as Element;
  placeholder.setAttribute(PARKED, "");
  host.replaceWith(placeholder);
  return placeholder;
}

/** Puts a parked scene back as the page first had it, with what the runtime wrote on its host; returns its scripts. */
export function unpark(
  name: string,
): { host: Element; placeholder: Element; scripts: Element[] } | null {
  const placeholder = hostOf(name);
  const parts = pristine.get(name);
  if (!placeholder || !isParked(placeholder) || !parts) return null;
  const template = document.createElement("template");
  template.innerHTML = parts.html;
  const host = document.importNode(template.content.firstElementChild!, true);
  for (const { name: attr, value } of Array.from(placeholder.attributes))
    if (attr !== PARKED) host.setAttribute(attr, value);
  placeholder.replaceWith(host);
  return { host, placeholder, scripts: parts.scripts.map((el) => el.cloneNode(true) as Element) };
}

/**
 * Before any scene script runs: keeps each windowed scene as written and parks those away from the start,
 * so their scripts never run until the playhead comes near. A page without a scene manifest is left alone.
 */
export function parkFarScenesAtBoot(time = 0): void {
  pristine.clear();
  parkedClips.clear();
  const hosts = windowedHosts();
  const near = scenesWanted(hosts, time, false);
  for (const { name, host } of hosts) {
    const scripts = Array.from(document.querySelectorAll(partsSelector(name, "script")));
    pristine.set(name, {
      html: host.outerHTML,
      scripts: scripts.map((el) => el.cloneNode(true) as Element),
    });
    if (!near.has(name)) park(name);
  }
}

// The runtime keeps a host's authored length under its own name, which an edit to the length replaces.
const AUTHORED_COPY: Record<string, string> = {
  "data-duration": AUTHORED_DURATION_ATTR,
  "data-end": AUTHORED_END_ATTR,
};

/** A parked scene is timed by its stand-in: it takes the host attributes an edit changed, keeping the runtime's. */
function retimeParked(placeholder: Element, before: Element, after: Element): void {
  const changed = new Set(
    [...before.getAttributeNames(), ...after.getAttributeNames()].filter(
      (attr) => before.getAttribute(attr) !== after.getAttribute(attr),
    ),
  );
  for (const attr of changed) {
    const value = after.getAttribute(attr);
    if (value === null) placeholder.removeAttribute(attr);
    else placeholder.setAttribute(attr, value);
    if (attr in AUTHORED_COPY) placeholder.removeAttribute(AUTHORED_COPY[attr]!);
  }
}

/** Forgets what a swap replaced: the swapped scene's new markup is what a later mount puts back. */
export function rememberScene(name: string, host: Element, scripts: Element[]): void {
  const old = pristine.get(name);
  if (!old) return;
  parkedClips.delete(name);
  const placeholder = hostOf(name);
  if (placeholder && isParked(placeholder)) {
    const template = document.createElement("template");
    template.innerHTML = old.html;
    retimeParked(placeholder, template.content.firstElementChild!, host);
  }
  pristine.set(name, {
    html: host.outerHTML,
    scripts: scripts.map((el) => el.cloneNode(true) as Element),
  });
}

/** The timeline's clips of each parked scene, built from its markup once and dropped when an edit changes it. */
export const parkedClips = new Map<string, RuntimeTimelineClip[]>();

const parkedName = (placeholder: Element): string | null => {
  const name = isParked(placeholder) ? placeholder.getAttribute(SCENE_PART_ATTR) : null;
  return name !== null && pristine.has(name) && placeholder.parentElement ? name : null;
};

/** A parked scene's markup, built detached under a copy of the film root; null for any other element. */
export function parkedSceneMarkup(placeholder: Element): Element | null {
  const name = parkedName(placeholder);
  if (name === null) return null;
  const detachedFilm = placeholder.parentElement!.cloneNode(false) as Element;
  const template = document.createElement("template");
  template.innerHTML = pristine.get(name)!.html;
  detachedFilm.append(template.content);
  return detachedFilm.firstElementChild;
}

/** The parked scenes, each able to build its markup for the timeline. */
export const parkedTimelineScenes = (): ParkedTimelineScene[] =>
  Array.from(document.querySelectorAll(`[${PARKED}]`)).flatMap((placeholder) => {
    const name = parkedName(placeholder);
    return name === null ? [] : [{ name, host: () => parkedSceneMarkup(placeholder)! }];
  });
