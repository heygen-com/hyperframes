/**
 * Reads the resolved variables for the current composition.
 *
 * Top-level path: declared defaults from `<html data-composition-variables="...">`
 * merged with `window.__hfVariables` (set at render time by the engine when
 * the user passes `hyperframes render --variables '<json>'`).
 *
 * Sub-comp path (per-instance scoping): when called inside a sub-composition
 * script wrapped by `compositionScoping.ts`, the wrapper shadows
 * `__hyperframes.getVariables` with a scoped variant that returns the
 * pre-merged values from `window.__hfVariablesByComp[compositionId]`. The
 * loader populates that table before running scripts, layering the host
 * element's `data-variable-values` over the sub-comp's declared defaults.
 *
 * Returns `Partial<T>` because not every declared variable is guaranteed to
 * have a default, and not every key in `__hfVariables` is guaranteed to be
 * declared. Callers are expected to destructure with their own fallbacks
 * where strictness matters:
 *
 *     const { title = "Untitled", theme = "light" } = getVariables<MyVars>();
 */
import { cssVariableName, detectSlugCollisions } from "../tokenSlug";

export function getVariables<
  T extends Record<string, unknown> = Record<string, unknown>,
>(): Partial<T> {
  if (typeof document === "undefined") return {} as Partial<T>;

  // Same collection the CSS-variable injection uses: <html> first, then any
  // composition element carrying the attribute (later declarers win), then
  // render-time overrides.
  const declarers = new Set<Element>();
  if (document.documentElement?.hasAttribute("data-composition-variables")) {
    declarers.add(document.documentElement);
  }
  for (const el of Array.from(document.querySelectorAll("[data-composition-variables]"))) {
    declarers.add(el);
  }
  const declaredDefaults: Record<string, unknown> = {};
  for (const el of declarers) {
    Object.assign(declaredDefaults, readDeclaredDefaults(el));
  }
  const overrides = readRenderOverrides();

  return { ...declaredDefaults, ...overrides } as Partial<T>;
}

/**
 * Extract `{id: default}` map from an element's `data-composition-variables`
 * attribute. Returns an empty object when the attribute is missing, the JSON
 * is unparseable, or the payload isn't an array. Exported so the
 * compositionLoader can compute the same defaults map for sub-comp instances.
 */
export function readDeclaredDefaults(root: Element | null): Record<string, unknown> {
  if (!root) return {};
  const raw = root.getAttribute("data-composition-variables");
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!Array.isArray(parsed)) return {};

  const out: Record<string, unknown> = {};
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !("default" in e)) continue;
    out[e.id] = e.default;
  }
  return out;
}

const APPLIED_VARS_ATTR = "data-hf-css-vars";

function hasInlineStyle(target: Element): target is Element & ElementCSSInlineStyle {
  return "style" in target && typeof (target as HTMLElement).style?.setProperty === "function";
}

/**
 * Define primitive-valued variables as CSS custom properties on `target`,
 * recording the applied names so re-init/unmount can clear them. Empty
 * strings are skipped — CSSOM setProperty("", …) REMOVES the property, and a
 * blank default has no CSS meaning anyway.
 */
export function applyCssVariables(target: Element, variables: Record<string, unknown>): void {
  if (!hasInlineStyle(target)) return;
  const applied: string[] = [];
  for (const [id, value] of Object.entries(variables)) {
    if ((typeof value === "string" && value !== "") || typeof value === "number") {
      const name = cssVariableName(id);
      target.style.setProperty(name, String(value));
      applied.push(name);
    }
  }
  if (applied.length > 0) target.setAttribute(APPLIED_VARS_ATTR, applied.join(" "));
}

/** Remove custom properties a previous applyCssVariables call defined. */
export function clearAppliedCssVariables(target: Element): void {
  if (!hasInlineStyle(target)) return;
  const applied = target.getAttribute(APPLIED_VARS_ATTR);
  if (!applied) return;
  for (const name of applied.split(" ")) {
    if (name.startsWith("--")) target.style.removeProperty(name);
  }
  target.removeAttribute(APPLIED_VARS_ATTR);
}

/**
 * Imported figma components reference brand tokens as `var(--slug, literal)`.
 * Define each declaring element's composition variables as CSS custom
 * properties ON THAT ELEMENT — scoping by the cascade, so two compositions
 * on one page can't clobber each other and a flattened sub-composition root
 * correctly styles only its own subtree.
 *
 * Declared DEFAULTS are define-if-absent: a value the author already styled
 * (stylesheet `:root` rule, compile-time emission, hand-written inline) wins
 * over the declared default, preserving pre-existing conventions where a
 * variable id coincides with an authored custom property. Render-time
 * overrides (`--variables` → `window.__hfVariables`) always win — that's
 * explicit user intent.
 */
export function injectCompositionCssVariables(doc: Document): void {
  const declarers = new Set<Element>();
  if (doc.documentElement?.hasAttribute("data-composition-variables")) {
    declarers.add(doc.documentElement);
  }
  for (const el of Array.from(doc.querySelectorAll("[data-composition-variables]"))) {
    declarers.add(el);
  }
  const overrides = readRenderOverrides();
  const allIds: string[] = [];
  for (const el of declarers) {
    allIds.push(...applyDeclaredForElement(el, overrides, doc.defaultView));
  }
  for (const group of detectSlugCollisions(allIds)) {
    console.warn(
      `composition variables ${group.join(", ")} collapse to the same CSS property ${cssVariableName(group[0] ?? "")} — rename one to avoid cross-talk`,
    );
  }
}

/** Apply one declarer's variables (define-if-absent for defaults, overrides
 * always win). Returns the declared ids for collision reporting. */
function applyDeclaredForElement(
  el: Element,
  overrides: Record<string, unknown>,
  view: Window | null,
): string[] {
  if (!hasInlineStyle(el)) return [];
  const declared = readDeclaredDefaults(el);
  const toApply: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(declared)) {
    if (id in overrides) continue; // overrides applied below, always win
    const name = cssVariableName(id);
    // define-if-absent: respect authored/compiled definitions
    const existing =
      el.style.getPropertyValue(name) ||
      (view ? view.getComputedStyle(el).getPropertyValue(name) : "");
    if (existing.trim() !== "") continue;
    toApply[id] = value;
  }
  for (const [id, value] of Object.entries(overrides)) {
    if (id in declared) toApply[id] = value;
  }
  applyCssVariables(el, toApply);
  return Object.keys(declared);
}

/** Parse a host element's `data-variable-values` JSON attribute (per-instance
 * sub-composition overrides). Shared by the runtime loader and the bundler. */
export function parseHostVariableValues(host: Element): Record<string, unknown> {
  const raw = host.getAttribute("data-variable-values");
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

/** Render-time variable overrides (`hyperframes render --variables`). */
export function readRenderOverrides(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const raw = (window as Window & { __hfVariables?: unknown }).__hfVariables;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}
