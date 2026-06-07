---
title: "fix: Pin fonts cross-platform — eliminate silent system-font fallback at render time"
status: active
type: fix
created: 2026-06-07
depth: Standard
origin: null
---

## Summary

System fonts (SF Mono, SF Pro, Menlo, Monaco, Consolas, Georgia, Verdana, etc.) silently fall back to generic families at render time because the deterministic font injector (`FONT_ALIASES`) has no mapping for them. The blank template and the `ensureFullDocument` CSS reset declare no `font-family` at all, so compositions start with browser defaults. Studio exposes macOS-only fonts (`COMMON_LOCAL_FONT_FAMILIES`) in its font picker with no warning that they break headless rendering. The fix expands `FONT_ALIASES` to cover all common system fonts across macOS/Windows/Linux, adds Inter + JetBrains Mono as defaults in templates and the CSS reset, upgrades the lint rule to catch unaliased system fonts, and annotates Studio's local font list so users see the render-time mapping.

---

## Problem Frame

When a composition author uses a system font like SF Mono or Menlo — either by typing it in CSS or selecting it in Studio's font picker — the deterministic font injector (`injectDeterministicFontFaces`) finds no match in `FONT_ALIASES`, passes the family name to Google Fonts, gets a 404 (it's not a Google Font), and silently leaves it unresolved. At render time in the Docker container, the font isn't installed, Chrome falls back to a generic monospace (DejaVu Sans Mono on Linux), and monospace alignment breaks because the metrics differ. The same pattern affects SF Pro, Menlo, Monaco, Consolas, Verdana, Tahoma, Calibri, Cambria, Georgia, Palatino, and other OS-bundled fonts.

A secondary issue: compositions scaffolded by `hyperframes init` or wrapped by `ensureFullDocument` have no default `font-family`, so any text element without an explicit font declaration renders in the browser's default serif (Times New Roman), which is never the intended look.

---

## Requirements

- R1. Every common system font across macOS, Windows, and Linux must map to a bundled canonical font in `FONT_ALIASES` so it renders deterministically
- R2. The blank template must declare `Inter` (sans-serif) and `JetBrains Mono` (monospace) as default fonts
- R3. The `ensureFullDocument` CSS reset must include a default `font-family` so wrapped fragments don't fall back to Times New Roman
- R4. The `TEXT_STYLES` constant must use `Inter` instead of `system-ui, -apple-system, sans-serif`
- R5. The lint rule `font_family_without_font_face` must warn about system fonts that aren't in `FONT_ALIASES` — not just fonts missing `@font-face`
- R6. The `PRODUCER_BUNDLED_FONTS` set in the lint rule must stay in sync with `FONT_ALIASES`
- R7. Studio's local font list must annotate fonts that are aliased to a bundled font at render time, so users know what they'll get
- R8. All existing tests must pass; new tests must cover the expanded alias map

---

## Key Technical Decisions

**KTD-1. Alias mapping strategy — map to metrically closest bundled font, not to a "safe generic".**
System sans-serif fonts (SF Pro, Calibri, Verdana, Segoe UI) map to Inter. System monospace fonts (SF Mono, Menlo, Monaco, Consolas, Lucida Console) map to JetBrains Mono. System serif fonts (Georgia, Palatino, Book Antiqua, Cambria) map to EB Garamond. This preserves the author's intent (category + approximate weight) while guaranteeing deterministic rendering. Rationale: mapping everything to Inter would destroy monospace alignment and serif aesthetics.

**KTD-2. Single source of truth for alias data — `FONT_ALIASES` in `deterministicFonts.ts` remains canonical; `PRODUCER_BUNDLED_FONTS` is generated from it.**
Today these two structures are manually kept in sync. Rather than continuing that, export the alias keys from the producer and import them in the lint rule. This eliminates drift permanently.

**KTD-3. Default font in templates — Inter for body, JetBrains Mono for code.**
These are already in `CANONICAL_FONTS` with embedded data URIs. No new font packages needed. The deterministic injector will auto-inject their `@font-face` rules when it sees them in the CSS.

**KTD-4. Studio annotation approach — add a `renderAlias` field to local font entries rather than removing them.**
Users may genuinely want to preview with their local SF Pro. The annotation tells them "renders as Inter in video output" so they can make an informed choice. Removing the fonts would break the Studio experience for macOS users who work locally.

---

## Scope Boundaries

### In Scope
- Expanding `FONT_ALIASES` with ~30 additional system font mappings
- Updating the blank template, `ensureFullDocument`, and `TEXT_STYLES` defaults
- Making `PRODUCER_BUNDLED_FONTS` derive from the canonical alias map
- Enhancing lint rules to catch system fonts
- Studio font catalog annotation
- Tests for all of the above

### Out of Scope (Non-Goals)
- Font subsetting (noted in the codebase as "not yet implemented" — separate concern)
- Adding new canonical fonts to the bundle (Inter, JetBrains Mono, EB Garamond already cover all needed categories)
- CJK system font aliases (Noto Sans JP is already bundled; CJK system fonts like PingFang, Hiragino, MS Gothic are a different problem with different solutions)
- Studio font picker UI redesign

### Deferred to Follow-Up Work
- Auto-generating `PRODUCER_BUNDLED_FONTS` at build time from the producer package export (would require a build-order dependency change)

---

## Implementation Units

### U1. Expand FONT_ALIASES with cross-platform system font mappings

**Goal:** Every common system font on macOS, Windows, and Linux resolves to a bundled canonical font.

**Requirements:** R1

**Dependencies:** None

**Files:**
- `packages/producer/src/services/deterministicFonts.ts`
- `packages/producer/src/services/deterministicFonts.test.ts`

**Approach:** Add entries to `FONT_ALIASES` for the following system fonts, grouped by target canonical:

*Maps to `inter` (sans-serif):*
- SF Pro, SF Pro Display, SF Pro Text, SF Pro Rounded
- Avenir, Avenir Next
- Lucida Grande, Lucida Sans, Lucida Sans Unicode
- Verdana, Tahoma, Trebuchet MS
- Calibri, Candara, Corbel
- Ubuntu (the system font, not the Google Font — same name, so the alias makes it deterministic)
- Noto Sans, DejaVu Sans, Liberation Sans
- Geneva, Optima

*Maps to `jetbrains-mono` (monospace):*
- SF Mono
- Menlo
- Monaco
- Consolas
- Lucida Console, Lucida Sans Typewriter
- Andale Mono
- DejaVu Sans Mono, Liberation Mono
- Ubuntu Mono (system variant)

*Maps to `eb-garamond` (serif):*
- Georgia
- Palatino, Palatino Linotype, Book Antiqua
- Cambria
- Times, Times New Roman
- DejaVu Serif, Liberation Serif

Export the `FONT_ALIASES` keys as a `Set<string>` named `FONT_ALIAS_KEYS` so the lint rule can import it.

**Patterns to follow:** Existing alias entries at lines 156-188 of `deterministicFonts.ts`. All keys are lowercase.

**Test scenarios:**
- Each new alias resolves to the expected canonical font key
- SF Mono resolves to jetbrains-mono
- SF Pro Display resolves to inter
- Menlo resolves to jetbrains-mono
- Consolas resolves to jetbrains-mono
- Georgia resolves to eb-garamond
- Times New Roman resolves to eb-garamond
- Verdana resolves to inter
- The existing aliases still resolve correctly (no regressions)

**Verification:** `bun run --cwd packages/producer test` passes. The exported `FONT_ALIAS_KEYS` set contains all new entries.

---

### U2. Update default fonts in templates and CSS reset

**Goal:** Compositions start with Inter and JetBrains Mono as default fonts, not browser defaults.

**Requirements:** R2, R3, R4

**Dependencies:** None (independent of U1 — the deterministic injector already handles Inter and JetBrains Mono)

**Files:**
- `packages/cli/src/templates/blank/index.html`
- `packages/core/src/templates/constants.ts`
- `packages/producer/src/services/htmlCompiler.ts`
- `packages/core/src/templates/base.test.ts`
- `packages/producer/src/services/htmlCompiler.test.ts`

**Approach:**

1. **Blank template** — add a `<style>` block with:
   ```
   body { font-family: "Inter", sans-serif; }
   code, pre, .monospace { font-family: "JetBrains Mono", monospace; }
   ```

2. **`TEXT_STYLES` constant** — change `font-family: system-ui, -apple-system, sans-serif` to `font-family: "Inter", sans-serif`.

3. **`ensureFullDocument` CSS reset** — add `font-family:"Inter",sans-serif` to the `body` rule. The deterministic injector will see the `Inter` declaration and inject its `@font-face`.

**Patterns to follow:** The existing CSS reset style in `ensureFullDocument` at line 710.

**Test scenarios:**
- `TEXT_STYLES` contains `"Inter"` and does not contain `system-ui` or `-apple-system`
- The blank template HTML contains `font-family: "Inter"` in a style block
- The blank template HTML contains `font-family: "JetBrains Mono"` for monospace
- `ensureFullDocument` output contains `font-family:"Inter"` in the body style
- Existing `base.test.ts` assertions still pass (update the font-family expectation)
- Fragment wrapping produces a document whose body has `font-family:"Inter",sans-serif`

**Verification:** `bun run --cwd packages/core test` and `bun run --cwd packages/producer test` pass.

---

### U3. Sync PRODUCER_BUNDLED_FONTS with FONT_ALIASES via import

**Goal:** Eliminate manual drift between the alias map in the producer and the lint rule's bundled-font list.

**Requirements:** R6

**Dependencies:** U1 (needs the exported `FONT_ALIAS_KEYS`)

**Files:**
- `packages/core/src/lint/rules/fonts.ts`
- `packages/producer/src/services/deterministicFonts.ts` (export already added in U1)

**Approach:** Replace the hardcoded `PRODUCER_BUNDLED_FONTS` set in `fonts.ts` with an import from the producer package. The producer already exports `FONT_ALIAS_KEYS` (added in U1). The lint rule imports it and uses it directly.

Check if `@hyperframes/producer` is already a dependency of `@hyperframes/core`. If not, consider exporting the alias keys from `@hyperframes/core` instead (since the lint rules live in core) by moving the canonical alias list to a shared location in core and importing it in both the producer and the lint rule.

If a circular dependency would result, export the alias key list as a plain JSON-serializable array from a shared file in core that both packages import, keeping `deterministicFonts.ts` as the runtime consumer and the lint rule as the build-time consumer.

**Test scenarios:**
- The lint rule's bundled font set matches the producer's alias keys exactly
- Adding a new alias in `deterministicFonts.ts` automatically makes the lint rule recognize it (verified by the import chain, not a separate test)
- Existing lint rule tests pass without modification (the recognized font set is a superset of the old one)

**Verification:** `bun run --cwd packages/core test` passes. Manually verify that `PRODUCER_BUNDLED_FONTS` is no longer a hardcoded set.

---

### U4. Enhance lint rule to warn about unaliased system fonts

**Goal:** The linter catches system-only fonts that will silently fall back at render time.

**Requirements:** R5

**Dependencies:** U3 (needs the synced bundled font set)

**Files:**
- `packages/core/src/lint/rules/fonts.ts`
- `packages/core/src/lint/rules/fonts.test.ts`

**Approach:** Add a new lint rule `system_font_will_alias` (severity: info) that fires when a composition uses a font family that exists in `FONT_ALIAS_KEYS` but is NOT the canonical name (i.e., it will be silently mapped). The message tells the user what it will render as: "Font 'SF Mono' will render as 'JetBrains Mono' in video output. Use 'JetBrains Mono' directly for consistent preview/render results."

This is distinct from the existing `font_family_without_font_face` rule (which warns about fonts that can't be resolved at all). The new rule covers fonts that CAN be resolved but will be substituted — an informational heads-up, not a warning.

Also add a `SYSTEM_FONT_FAMILIES` set (fonts that exist only as OS installations, not in Google Fonts) to distinguish them from Google Fonts in the `font_family_without_font_face` rule. A system font without an alias is a harder error than a Google Font without an alias (the Google Font can be fetched; the system font cannot).

**Patterns to follow:** Existing lint rules in `fonts.ts`.

**Test scenarios:**
- A composition using `font-family: "SF Mono", monospace` triggers `system_font_will_alias` with message mentioning JetBrains Mono
- A composition using `font-family: "Inter", sans-serif` does NOT trigger `system_font_will_alias` (Inter is the canonical name)
- A composition using `font-family: "Helvetica Neue", sans-serif` triggers `system_font_will_alias` with message mentioning Inter
- A composition using `font-family: "Comic Sans MS", sans-serif` with no `@font-face` triggers `font_family_without_font_face` (not aliased, not a Google Font)
- A composition using `font-family: "Roboto", sans-serif` does NOT trigger any font rule (Roboto is a canonical bundled font)

**Verification:** `bun run --cwd packages/core test` passes.

---

### U5. Annotate Studio font catalog with render-time aliases

**Goal:** Studio users see what their local fonts will render as in video output.

**Requirements:** R7

**Dependencies:** U1 (needs the alias map data)

**Files:**
- `packages/studio/src/components/editor/fontCatalog.ts`
- `packages/studio/src/components/editor/propertyPanelHelpers.ts`

**Approach:** Add a `RENDER_ALIAS_MAP` to `fontCatalog.ts` that maps local font family names to their render-time canonical names. This is a static map (not imported from the producer, to avoid a build dependency) that covers the `COMMON_LOCAL_FONT_FAMILIES` entries. The property panel helpers use this map to display "(renders as Inter)" or "(renders as JetBrains Mono)" next to local font names in the font picker dropdown.

Update `COMMON_LOCAL_FONT_FAMILIES` to remove entries that are already in the Google Fonts list or the canonical bundled font list (no point listing "Arial" as a "local font" when Inter is the canonical and Arial is already aliased). Keep only the genuinely local fonts (TT Norms Pro, SF Pro Display, SF Pro Text, Avenir, Avenir Next, Menlo, Monaco) and add the render alias annotation.

**Patterns to follow:** Existing `COMMON_LOCAL_FONT_FAMILIES` structure and `sortFontOptions` in `propertyPanelHelpers.ts`.

**Test scenarios:**
- `RENDER_ALIAS_MAP` maps "SF Pro Display" to "Inter"
- `RENDER_ALIAS_MAP` maps "Menlo" to "JetBrains Mono"
- `RENDER_ALIAS_MAP` maps "Monaco" to "JetBrains Mono"
- `COMMON_LOCAL_FONT_FAMILIES` no longer contains fonts that are in the Google or canonical bundled lists (Arial, Courier New, Helvetica Neue)
- Font picker helper produces annotation text for aliased local fonts

**Verification:** `bun run build` succeeds (Studio type-checks). Manual check: Studio font picker shows alias annotations.

---

## Open Questions

- **OQ-1.** Should the deterministic font injector log a warning when it resolves an alias (e.g., "SF Mono → JetBrains Mono")? Currently it silently substitutes. A warning would help debugging but could be noisy for compositions that intentionally use system font names. *Deferred to implementation — start silent, add opt-in verbose logging if needed.*

---

## System-Wide Impact

- **Existing compositions using system fonts** will now render with the aliased canonical font instead of an unpredictable fallback. This is a visual change but an intentional improvement — the previous behavior was already broken (wrong font rendered).
- **New compositions** will start with Inter instead of no font. This only affects compositions that had no explicit font-family declarations.
- **Lint output** will show new `system_font_will_alias` findings for compositions using aliased fonts. Severity is info, not warning — won't block CI.
- **Docker/CI rendering** is unaffected (system fonts were already falling back; now they fall back to the correct aliased font instead of a random generic).

---

## Sources & Research

- `packages/producer/src/services/deterministicFonts.ts` — canonical font injection engine with FONT_ALIASES and CANONICAL_FONTS
- `packages/core/src/lint/rules/fonts.ts` — lint rules with PRODUCER_BUNDLED_FONTS
- `packages/core/src/templates/constants.ts` — TEXT_STYLES with system-ui default
- `packages/cli/src/templates/blank/index.html` — blank template with no font declarations
- `packages/producer/src/services/htmlCompiler.ts` — ensureFullDocument CSS reset with no font-family
- `packages/studio/src/components/editor/fontCatalog.ts` — Studio font catalog with COMMON_LOCAL_FONT_FAMILIES
- `packages/producer/src/services/render/planValidation.ts` — system font validation for distributed rendering
- macOS system fonts: SF Pro, SF Mono, Menlo, Monaco, Avenir, Lucida Grande, Geneva, Optima, Palatino, Georgia, Courier
- Windows system fonts: Segoe UI (already aliased), Calibri, Cambria, Consolas, Candara, Corbel, Verdana, Tahoma, Trebuchet MS, Georgia, Palatino Linotype, Book Antiqua, Lucida Console, Lucida Sans Unicode
- Linux system fonts: DejaVu Sans/Serif/Mono, Liberation Sans/Serif/Mono, Noto Sans/Serif, Ubuntu (font family)
