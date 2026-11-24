/**
 * Whether a keystroke is going somewhere the user is typing.
 *
 * Every keyboard shortcut in Studio has to ask this before claiming a key, and
 * they were each asking it slightly differently. The version that matched
 * `[contenteditable='true']` missed `contenteditable="plaintext-only"`, which
 * is what inline text editing uses, so the playback shortcuts kept claiming
 * letters out of it: `a` seeked to the in-point and `e` to the out-point,
 * `preventDefault` and all, and the character never reached the text.
 *
 * `isContentEditable` is the property to ask, not the attribute to match: it is
 * true for every editable value and for an element made editable by an
 * ancestor, which an attribute selector on the target alone cannot see.
 * The wider input gate is deliberate too: checkboxes and readonly fields own
 * Space and arrow keys even when they do not accept text.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = elementThroughShadowFocus(target);
  if (!element) return false;
  if (element.isContentEditable) return true;
  return closestAcrossShadow(element, TYPING_SELECTOR) !== null;
}

/** Plain keys (arrows, Space, Delete) also belong to a focused slider or player; Cmd shortcuts still do not. */
export function ownsPlainKeys(target: EventTarget | null): boolean {
  return (
    isTypingTarget(target) ||
    closestAcrossShadow(elementThroughShadowFocus(target), KEY_OWNING_CONTROLS) != null
  );
}

// A slider steps and a native player seeks and plays with these keys themselves.
const KEY_OWNING_CONTROLS = "[role='slider'],video[controls],audio[controls]";

/**
 * Things a keystroke belongs to rather than to a shortcut. `contenteditable` is
 * matched by value as well, for a host whose own property is not yet true.
 */
const TYPING_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  // A switch is a button in the DOM, but the native checkbox it replaces was an
  // `input` and matched above. Without this row the shared Toggle would let a
  // global shortcut claim Space instead of flipping the control (KTD13).
  "[role='switch']",
  "[role='dialog'][aria-modal='true']",
  ".cm-editor",
].join(",");

function elementThroughShadowFocus(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as { closest?: unknown; shadowRoot?: ShadowRoot | null };
  if (typeof candidate.closest !== "function") return null;
  const inner = candidate.shadowRoot?.activeElement;
  return inner ? elementThroughShadowFocus(inner) : (target as HTMLElement);
}

function closestAcrossShadow(element: Element | null, selector: string): Element | null {
  for (let at = element; at; ) {
    const hit = at.closest(selector);
    if (hit) return hit;
    at = (at.getRootNode?.() as Partial<ShadowRoot> | undefined)?.host ?? null;
  }
  return null;
}

const PLAYBACK_SHORTCUT_IGNORED_SELECTOR = [
  "button",
  "a[href]",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  // Base UI's menu radio item is a `<div>`, so `button` above no longer catches it.
  "[role='menuitemradio']",
  "[role='radio']",
  "[role='spinbutton']",
].join(",");

export function shouldIgnorePlaybackShortcutTarget(target: EventTarget | null): boolean {
  // Anything the user is typing into owns its keys outright, editable elements
  // included: a letter claimed here never reaches the text. So does a native player.
  if (ownsPlainKeys(target)) return true;
  return (
    closestAcrossShadow(elementThroughShadowFocus(target), PLAYBACK_SHORTCUT_IGNORED_SELECTOR) !=
    null
  );
}
