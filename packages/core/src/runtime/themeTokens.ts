/**
 * The CSS custom properties a composition expects its HOST to define — the
 * theme namespace. Declared composition variables are injected as custom
 * properties too, so an id that happens to match one of these names would
 * overwrite the theme token by inline-style specificity and no host theme
 * could win it back. A variable declared `accent: "blue"` is not a colour, it
 * is a selector the composition maps onto `var(--accent)`; writing `--accent:
 * blue` makes that lookup resolve to the CSS keyword instead of the theme.
 *
 * Reserved ids therefore get the namespaced property ONLY (see
 * `variableCssPropertiesForId`), which is what stops the collision.
 *
 * Derivation, not memory — the names shipped theme blocks in this repo define
 * alongside `--accent`:
 *
 *     rg -U --pcre2 '\{[^{}]*--accent\s*:[^{}]*\}' -o skills registry docs
 *
 * ...filtered to theme ROLES (a slot a host fills: ground, ink, accent,
 * surface) and away from literal values (`--green`, `--cream`), typography
 * (`--font-*`, `--sans`) and component-local names (`--tab-bg`), which are not
 * a host contract and are better left aliasable.
 */

import { cssVariableName } from "../tokenSlug";

/** Reserved theme-token names, without the leading `--`. */
export const THEME_TOKENS: ReadonlySet<string> = new Set([
  "accent",
  "accent-2",
  "accent-3",
  "accent2",
  "bg",
  "border",
  "brand",
  "fg",
  "ink",
  "muted",
  "primary",
  "secondary",
  "surface",
  "tertiary",
  "text",
]);

/** The custom properties one injected variable writes. */
export interface VariableCssNames {
  /** Always written. Namespaced, so nothing else can be shadowed by it. */
  namespaced: string;
  /**
   * The bare name, kept as a deprecated alias for compositions that read
   * `var(--<id>)` today. `null` for a reserved id — writing it is the bug.
   */
  legacy: string | null;
}

/**
 * THE property names one injected variable writes. Every injection site takes
 * the raw variable id here — runtime bindings, runtime declared defaults, the
 * compiler and the SDK writer — so one id yields exactly one namespaced
 * property everywhere, and an authored `var(--hf-var-<slug>)` binding matches
 * whichever site happened to define it.
 *
 * Taking the id (not a pre-derived name) is the point: the slug is applied
 * here, once. `cssVariableName` is already the form the figma importer emits
 * `var(--<slug>)` against and the form the compiler bakes into shipped
 * output, and it is the only form guaranteed to be a legal custom-property
 * name — a raw id may carry spaces or dots. Slugging folds case, which the
 * reserved test below depends on: derived verbatim, the same declared id
 * `Accent` would be aliasable on one path and reserved on another.
 */
export function variableCssPropertiesForId(id: string): VariableCssNames {
  const bare = cssVariableName(id).slice(2);
  return {
    namespaced: `--hf-var-${bare}`,
    legacy: THEME_TOKENS.has(bare) ? null : `--${bare}`,
  };
}

/**
 * The one name define-if-absent tests. An authored definition can only be
 * clobbered by a name we would actually write, and a reserved id never writes
 * the bare one — so an authored `--accent` must not suppress `--hf-var-accent`.
 */
export function collidingCssName(id: string): string {
  const { namespaced, legacy } = variableCssPropertiesForId(id);
  return legacy ?? namespaced;
}
