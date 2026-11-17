// `restore-attributes`: an undo or redo that only changes identified elements' attributes, applied in place.
// The parent diffs the saved files and sends each changed element's full restored attribute set.

/** `hf:<data-hf-id>` or `id:<id>`, the key the parent's restore diff uses. */
export type RestoreElementKey = string;
export type RestoreAttribute = [name: string, value: string];
export type RestoreScope = {
  /** null: the active document, which is the whole preview; else a sub-composition file the preview inlines. */
  file: string | null;
  elements: { key: RestoreElementKey; attributes: RestoreAttribute[] }[];
};
/** `scripted`: the files keep an unchanged GSAP script, so an element GSAP has parsed needs a re-run instead. */
export type RestoreAttributesParams = { scopes: RestoreScope[]; scripted: boolean; time: number };

const MAX_SCOPES = 64;
const MAX_ELEMENTS = 2_000;
const MAX_ATTRIBUTES = 256;
const MAX_KEY_LENGTH = 512;
const MAX_VALUE_LENGTH = 200_000;
const ATTRIBUTE_NAME = /^[^\s"'>/=]{1,256}$/;
const IDENTITY_SELECTOR = "[id], [data-hf-id]";
const SAFE_TO_SET = new Set([
  "class",
  "style",
  "data-start",
  "data-end",
  "data-duration",
  "data-track-index",
  "data-media-start",
  "data-playback-start",
  "data-playback-rate",
  "data-volume",
  "data-audio-muted",
  "data-hidden",
  "data-label",
  "data-timeline-label",
  "data-width",
  "data-height",
  "data-x",
  "data-y",
  "data-hf-group",
]);
const safeToDrop = (name: string) =>
  SAFE_TO_SET.has(name) || name === "loading" || name.startsWith("data-");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";
const keysAre = (value: Record<string, unknown>, keys: string) =>
  Object.keys(value).sort().join() === keys;

function attribute(value: unknown): RestoreAttribute | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [name, text] = value;
  return typeof name === "string" &&
    ATTRIBUTE_NAME.test(name) &&
    typeof text === "string" &&
    text.length <= MAX_VALUE_LENGTH
    ? [name, text]
    : null;
}

function element(value: unknown): RestoreScope["elements"][number] | null {
  if (!isRecord(value) || !keysAre(value, "attributes,key")) return null;
  const { key, attributes } = value;
  if (typeof key !== "string" || key.length > MAX_KEY_LENGTH || !/^(hf|id):./.test(key))
    return null;
  if (!Array.isArray(attributes) || attributes.length > MAX_ATTRIBUTES) return null;
  const parsed = attributes.map(attribute);
  return parsed.every(Boolean) ? { key, attributes: parsed as RestoreAttribute[] } : null;
}

const isScopeFile = (file: unknown): file is string | null =>
  file === null || (typeof file === "string" && file.length > 0 && file.length <= MAX_KEY_LENGTH);

function scope(value: unknown): RestoreScope | null {
  if (!isRecord(value) || !keysAre(value, "elements,file")) return null;
  const { file, elements } = value;
  if (!isScopeFile(file) || !Array.isArray(elements) || !elements.length) return null;
  const parsed = elements.map(element);
  return parsed.every(Boolean) ? { file, elements: parsed as RestoreScope["elements"] } : null;
}

export function parseRestoreAttributes(params: unknown): RestoreAttributesParams | null {
  if (!isRecord(params) || !keysAre(params, "scopes,scripted,time")) return null;
  const { scopes, scripted, time } = params;
  if (typeof scripted !== "boolean") return null;
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0) return null;
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > MAX_SCOPES) return null;
  const parsed = scopes.map(scope);
  if (!parsed.every(Boolean)) return null;
  const count = (parsed as RestoreScope[]).reduce((n, s) => n + s.elements.length, 0);
  return count <= MAX_ELEMENTS ? { scopes: parsed as RestoreScope[], scripted, time } : null;
}

function identityKey(el: Element): RestoreElementKey | null {
  const hfId = el.getAttribute("data-hf-id");
  if (hfId) return `hf:${hfId}`;
  const id = el.getAttribute("id");
  return id ? `id:${id}` : null;
}

/** Every identified element under `root` by key, or null when two share one. */
function identityMap(root: ParentNode): Map<RestoreElementKey, Element> | null {
  const map = new Map<RestoreElementKey, Element>();
  for (const el of root.querySelectorAll(IDENTITY_SELECTOR)) {
    const key = identityKey(el);
    if (!key) continue;
    if (map.has(key)) return null;
    map.set(key, el);
  }
  return map;
}

// The active document is the whole preview; a sub-composition lives in each host that inlines it.
function scopeRoots(file: string | null): ParentNode[] {
  if (file === null) return [document];
  return Array.from(document.querySelectorAll("[data-composition-file]")).filter(
    (host) => host.getAttribute("data-composition-file") === file,
  );
}

type RestorePlan = [Element, drop: string[], set: RestoreAttribute[]][];

/** Adds `root`'s live elements to `plan`; false when any is missing, not the file's own, or unsafe to change. */
function planRoot(
  root: ParentNode,
  elements: RestoreScope["elements"],
  plan: RestorePlan,
): boolean {
  const live = identityMap(root);
  if (!live) return false;
  for (const { key, attributes } of elements) {
    const el = live.get(key);
    // The preview rewrites a sub-composition's own root, so its attributes are not the file's.
    if (!el || el.hasAttribute("data-hf-inner-root")) return false;
    const keep = new Set(attributes.map(([name]) => name));
    const drop = el.getAttributeNames().filter((name) => !keep.has(name));
    const set = attributes.filter(([name, value]) => el.getAttribute(name) !== value);
    if (!drop.every(safeToDrop) || !set.every(([name]) => SAFE_TO_SET.has(name))) return false;
    plan.push([el, drop, set]);
  }
  return true;
}

/** Each live element with the attributes it drops and sets, or null when the restore cannot apply in place. */
function planRestore(scopes: RestoreScope[]): RestorePlan | null {
  const plan: RestorePlan = [];
  for (const { file, elements } of scopes) {
    const roots = scopeRoots(file);
    if (!roots.length || !roots.every((root) => planRoot(root, elements, plan))) return null;
  }
  return plan;
}

type RestoreWindow = Window & {
  __player?: { seek?: (t: number) => void; isPlaying?: () => boolean; play?: () => void };
  __hfForceTimelineRebind?: () => void;
  __hfStudioManualEditsApply?: () => void;
  __hfSuppressSceneMutations?: <T>(fn: () => T) => T;
};

/** Rebinds the timeline to the live attributes at `time`, as an in-place soft reload does, without running scripts. */
function rebindAt(win: RestoreWindow, time: number): void {
  const finalize = () => {
    const wasPlaying = win.__player?.isPlaying?.() === true;
    win.__player?.seek?.(time);
    win.__hfForceTimelineRebind?.();
    win.__hfStudioManualEditsApply?.();
    if (wasPlaying) win.__player?.play?.();
  };
  if (win.__hfSuppressSceneMutations) win.__hfSuppressSceneMutations(finalize);
  else finalize();
}

/** Applies the restore in place; `applied: false` changes nothing, and the parent reloads instead. */
export function restoreAttributes({ scopes, scripted, time }: RestoreAttributesParams): {
  applied: boolean;
} {
  const win = window as RestoreWindow;
  const plan = planRestore(scopes);
  if (!plan || typeof win.__player?.seek !== "function") return { applied: false };
  if (scripted && plan.some(([el]) => "_gsap" in el)) return { applied: false };
  for (const [el, drop, set] of plan) {
    for (const name of drop) el.removeAttribute(name);
    for (const [name, value] of set) el.setAttribute(name, value);
  }
  rebindAt(win, time);
  return { applied: true };
}
