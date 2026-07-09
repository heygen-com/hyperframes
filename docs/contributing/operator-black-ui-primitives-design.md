# Operator Black UI Primitives — Design Specification

- **Status:** Approved for implementation
- **Approval date:** 2026-07-09
- **Branch:** `feat-video-primitives`
- **Frozen baseline:** `96b1dd7beeeea01c637aca2cff2ec94fcc83fe02`
- **Frozen comparison base:** `8e04d0196945c5173923fb72ecc665d40d122adb`
- **Scope:** 66 newly added registry entries tagged `ui-primitive`
- **Approval basis:** The user delegated the remaining choices, reviewed the consolidated direction board, and approved it with “ship it.”

## 1. Objective

Redesign the 66 UI primitives introduced on `feat-video-primitives` as one coherent HyperFrames-native system. The result should feel like a quiet production instrument: minimalist, physically believable, dark-first, and precise without looking sterile.

The redesign must improve both the installable canonical snippet and its catalog demo. It must not change pre-existing `origin/main` components or any newly added entry outside the frozen 66-item allowlist.

The system is named **Operator Black**. Its motion language is named **Soft Optical**.

## 2. Approved direction

The approved direction board resolves the remaining visual choices as follows:

| Axis | Approved decision |
| --- | --- |
| Theme | Dark-first Operator Black with a coordinated warm-paper light theme |
| Material | Matte surfaces, fine one-pixel edges, and visible press response |
| Hierarchy | Alignment and open space first; rules only where structure requires them |
| Typography | Calm sans-serif labels and prose; monospace only for technical values |
| Geometry | `5px` controls, `7px` raised surfaces, `10px` overlays |
| Density | `40px` default controls, with `44px` coarse-pointer hit targets |
| Accent | Mint for focus, selection, progress, and real semantic success only |
| Selected state | Recessed surface and brighter text, with the family-specific mint treatment defined in Section 7 |
| Overlays | Menus/popovers/tooltips open from their trigger; dialogs stay centered; drawers/sheets attach to an edge; toasts follow their stack origin |
| Icons | Technical SVG outlines, `1.5px` stroke, square caps and joins |
| Motion | Soft Optical: tiny blur and `0.98` scale on entry, faster exits, no bounce |

These are final design decisions, not open questions.

## 3. Exact scope

### 3.1 Inclusion rule

An entry is in scope only when all of the following are true at the frozen baseline:

1. Its manifest is newly added between the frozen comparison base and frozen feature baseline.
2. Its manifest contains the exact tag `ui-primitive`.
3. Its manifest has none of the tags `ui-flow`, `motion`, `transition`, `typography`, or `showcase`.

The literal allowlist wins over category inference. Names such as `blur-in`, `caret`, `cursor`, `registry`, and `remocn-ui` remain in scope because their manifests satisfy the rule.

The reproducible selection is:

```bash
BASE=8e04d0196945c5173923fb72ecc665d40d122adb
HEAD=96b1dd7beeeea01c637aca2cff2ec94fcc83fe02

git diff --diff-filter=A --name-only "$BASE" "$HEAD" \
  -- 'registry/components/*/registry-item.json' |
while IFS= read -r file; do
  git show "$HEAD:$file" | jq -e '
    ((.tags | index("ui-primitive")) != null) and
    ([.tags[] | select(
      . == "ui-flow" or . == "motion" or . == "transition" or
      . == "typography" or . == "showcase"
    )] | length == 0)
  ' >/dev/null && git show "$HEAD:$file" | jq -r '.name'
done | sort
```

Appendix A is authoritative after this freeze even if `origin/main` advances.

For each ID `<id>`, the three owned files are:

```text
Canonical: registry/components/<id>/<id>.html
Demo:      registry/components/<id>/demo.html
Manifest:  registry/components/<id>/registry-item.json
```

All 198 files exist and were added between the frozen comparison base and frozen feature baseline.

### 3.2 Non-goals

- Do not redesign pre-existing components from `origin/main`.
- Do not redesign UI flows, transition primitives, typography primitives, motion primitives, or showcase entries outside the allowlist.
- Do not turn these snippets into a live-application framework; they remain self-contained, deterministic HyperFrames components.
- Do not change install names, manifest types, target paths, or registry identities.
- Do not introduce a global docs restyle that changes unrelated catalog pages.
- Do not upload preview media or mutate an external CDN as part of implementation. Local preview regeneration is required; publishing remains a separate release action.

### 3.3 Constraint meanings

- **No nested cards** prohibits gratuitous container-inside-container framing. It does not remove the semantic `card` primitive or legitimate overlays.
- **No decorative dots** does not prohibit radio indicators, switch thumbs, avatar circles, carousel position controls, or other shapes with a functional meaning.
- **No gradients** is absolute for this slice, including skeleton shimmer. Loading must use solid layers, opacity, clipping, or deterministic motion instead.
- **No glass** prohibits translucent frosted panels, persistent surface/background blur, and `backdrop-filter`. Soft Optical may use transient element blur up to `1.5px`; the semantic `blur-in` primitive may use deliberate content blur within its documented state contract. The `backdrop` primitive uses a flat dimming layer.

### 3.4 Permitted support and generated changes

The owned visual files remain the 198 canonical/demo/manifest paths. The implementation may also change only these support surfaces:

- `registry/ui-primitives/**` for the frozen scope, generated-token source, state inventory, and pinned preview assets;
- `scripts/sync-ui-primitives.ts` and focused tests for synchronization/parity;
- `scripts/generate-catalog-previews.ts` and focused tests for strict allowlist assembly;
- `packages/core/src/registry/remocnUiPrimitivesCatalog.test.ts`, `packages/core/src/registry/uiPrimitives*.ts`, and `packages/core/src/registry/__fixtures__/ui-primitives/**` for scope/contract/state tests;
- `packages/producer/package.json`, `packages/producer/tests/ui-primitives/**`, and `bun.lock` for the existing Puppeteer harness plus a pinned `axe-core` accessibility dependency;
- `.github/workflows/ui-primitives.yml` and the UI-primitive job in `.github/workflows/catalog-previews.yml` for the pinned verification environment;
- the 66 generated `docs/catalog/components/<id>.mdx` pages;
- only the corresponding 66 records in `docs/public/catalog-index.json`;
- local generated preview artifacts for the 66 IDs, which are verification output and are not published automatically.

Hand-edit canonical snippets, manifests, token/state sources, scripts, and tests. Generate demo canonical regions, catalog MDX, catalog-index records, and preview media from their declared sources.

## 4. Shared system architecture

### 4.1 One source of truth, self-contained output

The system uses these named sources:

```text
registry/ui-primitives/operator-black.tokens.json
registry/ui-primitives/operator-black.scope.json
scripts/sync-ui-primitives.ts
```

Together they are the machine-readable source of truth for:

- semantic color tokens;
- typography stacks and roles;
- spacing and geometry;
- elevation;
- focus treatment;
- motion durations and easings;
- the frozen 66-item allowlist.

`scripts/sync-ui-primitives.ts` generates the shared token block into every canonical snippet between `/* hf-ui:tokens:start */` and `/* hf-ui:tokens:end */`. Generated snippets remain self-contained when installed, while generation and CI prevent 66 manually divergent copies. Running the script twice must produce an empty second diff.

Every primitive root receives `data-hf-ui-root`. Dark is the fallback theme. Light can be selected on the primitive or any ancestor:

```html
<div data-hf-theme="light">
  <!-- installed primitive -->
</div>
```

Both of these selectors must work:

```css
[data-hf-theme="light"] [data-hf-ui-root] { /* light fallbacks */ }
[data-hf-ui-root][data-hf-theme="light"] { /* light fallbacks */ }
```

Public tokens use the `--hf-ui-*` prefix. Component-specific variables that already exist keep their current names. Generated theme selectors assign only private `--_hf-ui-*` values, each of which resolves a public host override before its theme fallback:

```css
[data-hf-ui-root] {
  --_hf-ui-surface: var(--hf-ui-surface, #141414);
}

[data-hf-theme="light"] [data-hf-ui-root],
[data-hf-ui-root][data-hf-theme="light"] {
  --_hf-ui-surface: var(--hf-ui-surface, #ffffff);
}
```

Component properties consume the private resolved value. No generated rule assigns a public `--hf-ui-*` token, so ancestor overrides always win. The private prefix is not consumer API.

Primitive roots remain transparent unless the primitive semantically owns a surface or canvas. Adding the theme contract must not paint a generic panel behind every component.

### 4.2 Themeability

Component properties consume the generated private resolved values, which in turn read public host tokens before using theme fallbacks. A host may override public tokens on an ancestor or on the primitive root without editing canonical CSS. Geometry, behavior, markup, states, and motion timings remain identical between themes; only semantic color and shadow tokens change.

Each theme declares the matching `color-scheme` so native controls agree with the designed surface.

### 4.3 Canonical/demo parity

`<id>.html` is the authoritative component implementation. `demo.html` contains a generated canonical region sourced from that file between `<!-- hf-ui:canonical:start -->` and `<!-- hf-ui:canonical:end -->`.

Normalization converts line endings to LF, removes trailing whitespace, and preserves exactly one terminal newline before computing a SHA-256 hash. CI runs the sync script in check mode, verifies marker uniqueness, compares hashes, and verifies idempotence.

Demo-only code may provide:

- the composition wrapper and canvas;
- safe presentation scaling;
- theme selection;
- deterministic GSAP choreography;
- captions outside the component root.

Demo-only CSS may not target anything inside `[data-hf-ui-root]`, including `.hf-ui-*`, `.hf-remocn-*`, generic baseline classes, element selectors, or public/component variables. It may not repair a missing state or substitute different component markup. CI compares the normalized canonical hash and compares same-theme computed styles for a standalone canonical mount versus its demo mount.

## 5. Compatibility contract

Before visual edits, generate a machine-readable contract snapshot from the frozen baseline containing, for every canonical snippet:

- every markup class token, including non-prefixed classes such as `is-active`, `danger`, `row`, `hint`, `avatar`, and `wide`;
- element types, IDs, roles, ARIA relationships/states, and DOM relationships used by direct-child or sibling selectors;
- every canonical CSS selector with its baseline match count, including positional/order dependencies such as `:first-child`, `:last-child`, and sibling combinators;
- every existing `data-*` attribute and documented literal value;
- every literal CSS custom-property input found in canonical markup, CSS, and timeline comments, including short names such as chart input `--h`, excluding only the new generated-private prefix;
- every selector named by timeline integration comments;
- the manifest `name`, `type`, tags, file path, target path, file type, and `preview.poster`.

All baseline CSS custom properties are treated as public unless the committed contract snapshot explicitly classifies one as private with evidence. The redesign may add classes, attributes, tokens, and values. It may not remove, rename, or repurpose a baseline contract. Existing timeline-facing CSS variables remain valid; a new internal variable may be added behind them, but consumers must not need to migrate.

Default to no new wrapper. If a wrapper is unavoidable, compatibility tests must prove that direct-child selectors, sibling selectors, layout, timeline targets, and selector cardinality remain unchanged.

Semantic markup, ARIA state, keyboard behavior, and install behavior must be preserved or improved. A compatibility test must report zero removals, renames, selector collisions, or semantic regressions across all 66 entries.

## 6. Visual foundation

### 6.1 Color tokens

| Public token | Dark fallback | Light fallback | Use |
| --- | --- | --- | --- |
| `--hf-ui-canvas` | `#0a0a0a` | `#f6f5f1` | Continuous base plane |
| `--hf-ui-surface` | `#141414` | `#ffffff` | Controls and resting surfaces |
| `--hf-ui-surface-raised` | `#1a1a1a` | `#ffffff` | Legitimately raised content |
| `--hf-ui-surface-inset` | `#101010` | `#f0efeb` | Pressed and selected surfaces |
| `--hf-ui-border` | `#2a2a2a` | `#e0dfdb` | Default one-pixel edge |
| `--hf-ui-border-strong` | `#383838` | `#cbc9c3` | Raised structural and overlay edge |
| `--hf-ui-control-border` | `#686868` | `#888888` | Accessible interactive boundary |
| `--hf-ui-control-border-hover` | `#777777` | `#6f6e68` | Hovered/active interactive boundary |
| `--hf-ui-text` | `#e5e5e5` | `#171717` | Primary text |
| `--hf-ui-text-strong` | `#f3f3f3` | `#0a0a0a` | Headings and high emphasis |
| `--hf-ui-text-muted` | `#929292` | `#5f5f5a` | Supporting text |
| `--hf-ui-text-faint` | `#7e7e7e` | `#6f6e68` | Nonessential metadata and decoration only |
| `--hf-ui-accent` | `#3ce6ac` | `#087a57` | Selection, progress, focus, real success |
| `--hf-ui-danger` | `#ff7878` | `#a61b1b` | Genuine destructive/error state |
| `--hf-ui-warning` | `#e9ab55` | `#8a4b00` | Genuine warning state |
| `--hf-ui-action` | `#eeeeee` | `#171717` | Primary action face |
| `--hf-ui-action-contrast` | `#111111` | `#ffffff` | Primary action text/icon |

Primary actions use neutral inversion, not mint.

Mint never appears in logos, ornamental marks, idle decoration, or generic badges. Semantic colors may appear only when the component actually communicates that semantic state.

Charts may use the following centrally declared solid categorical palette in addition to the semantic tokens. Chart colors never leak into general interface chrome and never use gradients.

| Data token | Dark fallback | Light fallback |
| --- | --- | --- |
| `--hf-ui-data-1` | `#3ce6ac` | `#087a57` |
| `--hf-ui-data-2` | `#63a5ff` | `#245ea8` |
| `--hf-ui-data-3` | `#e9ab55` | `#8a4b00` |
| `--hf-ui-data-4` | `#a78bfa` | `#6d3fc0` |
| `--hf-ui-data-5` | `#ff8a75` | `#a83d2d` |

### 6.2 Typography

- UI labels and prose: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Technical values: `ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`.
- Canonical snippets and demos use these exact guaranteed generic/system stacks and contain no font import. The preview harness does not inject a preferred face that installed users do not receive. Visual tests pin the operating-system font set so snapshots remain stable within the test environment.
- Allowed UI weights: `400`, `500`, and `600`.
- Minimum functional sizes: `11px` metadata, `12px` supporting copy, `13px` controls, and `14px` body copy before demo scaling.
- Monospace is reserved for timecodes, dimensions, counters, file names, numeric data, and keyboard shortcuts.
- Changing numbers use tabular figures.
- Headings may use negative tracking; body and control copy do not.

### 6.3 Geometry and density

| Token | Value | Use |
| --- | --- | --- |
| `--hf-ui-radius-control` | `5px` | Buttons, inputs, segmented choices, keys |
| `--hf-ui-radius-surface` | `7px` | Cards and raised surfaces |
| `--hf-ui-radius-overlay` | `10px` | Dialogs, menus, drawers, toasts |
| `--hf-ui-control-height` | `40px` | Default visible control height |
| `--hf-ui-hit-target` | `44px` | Coarse-pointer/touch hit area |

On coarse pointers, a control that remains visually `40px` expands its hit area to `44px` through a pseudo-element or nonvisual wrapper. Expanded targets must not overlap neighboring controls or change layout; fixtures verify pointer ownership and stacking.

Full pills and circles are permitted only when geometry communicates function. Examples include switches, radios, avatars, spinners, and semantic badges.

Spacing uses `4`, `8`, `12`, `16`, `24`, `32`, `48`, and `64px`. Internal control gaps are normally `8–12px`; related rows use `12–16px`; distinct groups use at least `24px`. Routine settings, menu, form, and list rows use spacing only. Rules are permitted only for structural boundaries such as table headers, split panes, the explicit `separator` primitive, and attached overlay edges.

### 6.4 Surfaces and elevation

| Public token | Dark fallback | Light fallback |
| --- | --- | --- |
| `--hf-ui-shadow-inset` | `inset 0 1px 0 rgba(255, 255, 255, 0.035)` | `inset 0 1px 0 rgba(255, 255, 255, 0.78)` |
| `--hf-ui-shadow-contact` | `0 8px 18px rgba(0, 0, 0, 0.38)` | `0 7px 16px rgba(26, 24, 20, 0.13)` |
| `--hf-ui-shadow-modal` | `0 18px 46px rgba(0, 0, 0, 0.52)` | `0 18px 46px rgba(26, 24, 20, 0.18)` |

- Resting interactive controls use the accessible control-border token, an opaque matte fill, and at most the shared inset highlight. Quiet structural rules use the lower-contrast border token.
- Pressed/selected controls use the inset surface and a short inner shadow.
- Cards are single semantic surfaces on the canvas. A card does not gain another generic panel merely to group its content.
- Menus, popovers, tooltips, toasts, and dialogs use opaque surfaces and a compact contact shadow.
- Drawers and sheets use a stronger but still short directional shadow at the attached edge.
- Diffuse decorative shadows, ambient glows, persistent surface/background blur, `backdrop-filter`, and faux lighting gradients are prohibited.

### 6.5 Iconography

- Use inline SVG on a shared optical grid.
- Default visible size is `18px`; compact contexts may use `14–16px` while preserving the hit target.
- Icons use a `24 × 24` optical grid and a `1.5px` stroke with square caps and miter/square joins. Optical correction changes path geometry, not the shared stroke weight.
- No text `x`, Unicode chevron, or improvised symbol may stand in for an action icon.
- Keyboard legends remain valid inside `<kbd>`.
- Decorative SVGs are `aria-hidden`; icon-only controls have accessible names.

## 7. Interaction state contract

Every applicable primitive documents and renders the following states. A state that does not apply must be marked `N/A` in the component state inventory rather than silently omitted.

| State | Required treatment |
| --- | --- |
| Idle | Matte surface, default edge, readable label |
| Hover | Stronger edge or small tonal change; no lift; fine-pointer devices only |
| Pressed | `translateY(1px) scale(0.98)` or equivalent inset compression |
| Focus-visible | Unclipped `2px` focus outline with `3px` offset; separate from selected state |
| Selected/current | Inset surface, brighter label, restrained mint edge/check/underline |
| Open | Visible relationship to its trigger/edge/stack, synchronized `aria-expanded` where applicable, and the component-family origin from Section 8.2 |
| Disabled | Semantic disabled state, no hover/press, clearly reduced emphasis, non-pointer cursor |
| Loading | Stable geometry; deterministic finite indicator; label remains accessible |
| Invalid/error | Danger edge plus readable message and programmatic invalid state |
| Success | Neutral or semantic check/message only after a real successful outcome |

Selected-state mint is deterministic by family:

| Family | Mint treatment |
| --- | --- |
| Checkbox, radio, switch | Functional mark, thumb, or active track |
| Tabs, toggle groups, button groups, pagination, calendar | `2px` inset bottom edge |
| Menu, command, select, list-like choices | `1.5px` SVG check aligned to the selection column |
| Progress, steps, slider | Filled progress/active segment |
| Horizontal navigation and menubar | `2px` inset bottom edge |
| Sidebar and vertical navigation | `2px` inset logical-start edge |
| Breadcrumb current page | No mint; strong text only |

High-frequency keyboard actions must not wait for decorative motion. Hover styles are gated by `(hover: hover) and (pointer: fine)`.

## 8. Soft Optical motion

### 8.1 Tokens

| Purpose | Duration | Default behavior |
| --- | --- | --- |
| Press/tap | `120ms` | `1px` downstroke and scale to `0.98` |
| Small state change | `160ms` | Opacity/color/short transform |
| Anchored overlay enter | `210ms` | Opacity, scale from `0.98`, max `4px` travel, max `1.5px` blur |
| Anchored overlay exit | `140ms` | Faster fade, scale toward `0.99`, max `2px` travel |
| Modal enter/exit | `280ms` / `180ms` | Centered optical scale; no directional drift |
| Drawer/sheet enter/exit | `360ms` / `240ms` | Edge-attached translation with physical deceleration |

Default entrance ease:

```css
cubic-bezier(0.32, 0.72, 0, 1)
```

Default response ease:

```css
cubic-bezier(0.23, 1, 0.32, 1)
```

Default exit ease:

```css
cubic-bezier(0.23, 1, 0.32, 1)
```

### 8.2 Rules

- Menus, popovers, hover cards, and tooltips set transform origin at their trigger; dialogs remain centered; drawers and sheets originate at their attached edge; toasts originate at the top logical-end of their stack unless an existing side variant is selected.
- Live preview mode may use the exact CSS transition tokens for interruptible UI.
- Deterministic render mode is selected with `data-hf-rendering="true"` on the primitive or an ancestor. A generated rule disables native CSS transitions and animations in that mode; paused GSAP timelines interpolate the same public/component variables directly.
- Every catalog demo enables deterministic render mode before creating its paused, registered timeline.
- Routine UI never bounces, overshoots, scales from zero, or uses `back.out`.
- Do not use `transition: all` or `ease-in`.
- Explanatory sequences may stagger by `30–50ms`; routine lists and menus do not.
- No unbounded animation loops. Spinner, caret, skeleton, and progress demos use finite seek-safe cycles.
- Animate transforms and opacity first. Blur is limited to small entering/exiting surfaces.

### 8.3 Reduced motion

Under `prefers-reduced-motion: reduce`:

- remove translation, scale, blur, parallax, stagger, shimmer, and spinning;
- preserve state with instant or short opacity/color changes;
- keep content visible without relying on an animation’s final frame;
- preserve identical semantics, focus, and keyboard behavior.

## 9. Accessibility, resilience, and determinism

### 9.1 Accessibility

- Normal text meets WCAG 2.2 AA `4.5:1`; large text, icons, control boundaries, and focus indicators meet `3:1`.
- Faint colors are used only for decoration, nonessential metadata, or truly disabled content.
- Canonical snippets use native elements where possible and expose correct static role, name, value, and ARIA state for the rendered `data-*` state.
- These are timeline-driven render primitives, not a new runtime controller library. Full focus traps, roving tabindex, menu navigation, and event handlers are required only where that live behavior already exists at the frozen baseline; otherwise host integration owns the controller behavior.
- Hidden overlay states use `hidden` or `inert` to leave both the focus order and accessibility tree. Synchronized `aria-hidden` may supplement those mechanisms but may not be the sole treatment when descendants are focusable.
- Catalog demos mark purely illustrative specimens `inert`; a separate semantic fixture mounts the canonical region without `inert` for Puppeteer and axe-core assertions.
- Any live interaction behavior present at the frozen baseline, including Escape, focus restoration, or arrow-key handling, is preserved and tested.
- Progress, selection, expansion, invalid, busy, and live status are programmatically exposed.
- Focus remains visible at 200% and 400% zoom and under forced colors.

### 9.2 Responsive and content resilience

A separate responsive harness mounts the canonical region into controlled containers rather than resizing or scaling the fixed 1920×1080 catalog demo. It covers `280`, `360`, `640`, `1024`, and `1920px` container widths plus short viewport heights.

Required fixtures include:

- labels and descriptions at two to three times normal length;
- compound words, long filenames/URLs, negative and large values;
- multiline validation, toast, alert, dialog, and empty-state copy;
- LTR and RTL for directional controls;
- explicit scroll regions for tables or code-like values.

No fixture may produce accidental page overflow, clipped focus, overlapping copy, unreachable actions, or off-screen overlays. Logical properties are preferred. Directional icons mirror in RTL; non-directional icons do not.

### 9.3 Deterministic rendering

Authored canonical and demo code must not depend at render time on:

- remote scripts, styles, fonts, images, or CSS URLs;
- `fetch`, XHR, WebSocket, EventSource, or dynamic remote imports;
- `Date.now()`, `performance.now()`, unseeded `Math.random()`, or random UUIDs;
- render-critical timers or accumulated event-driven state;
- unbounded CSS, WAAPI, or GSAP loops.

Manifest preview metadata URLs are exempt because they are not render-time dependencies.

The approved pinned `registry/ui-primitives/vendor/gsap-3.14.2.min.js` runtime is also exempt from literal clock/ticker source scans. Demos may use it only through paused, explicitly positioned timelines; shuffled-order frame-hash tests prove deterministic use.

Demo timelines are created synchronously, paused, and registered on `window.__timelines` under the exact composition ID. Out-of-order frame sampling must match sequential sampling.

`registry/ui-primitives/visual-test-image.lock.json` records an immutable container-image digest and the Chrome-for-Testing revision declared by the locked Puppeteer package. CI launches that revision, records `browser.version()`, and fails on mismatch. The environment also pins device-pixel ratio, fonts, locale, and timezone. The harness awaits `document.fonts.ready` and completion of every local asset before its first sample. For every demo, capture the start, each named state boundary, one midpoint, and the final valid frame—`(frameCount - 1) / fps`—three times in sequential order, then again in shuffled order. Corresponding frame hashes must be identical within the pinned environment.

## 10. Demo and catalog presentation

Each demo uses one continuous matte canvas and one representative component composition. It must not introduce a generic card merely to frame the primitive.

The demo may scale a wrapper for 1920×1080 legibility, but canonical dimensions and geometry remain unchanged. Captions are plain, useful, and outside the component root. Demos show supported states deliberately rather than relying on ambient looping.

The sole pinned preview dependency lives at:

```text
registry/ui-primitives/vendor/gsap-3.14.2.min.js
```

The preview assembler preserves the `registry/components/<id>` and `registry/ui-primitives/vendor` relative layout inside its workspace, so demos resolve only local assets. It exposes `--allowlist <path>`, `--prepare-only <directory>`, and `--keep-workspace`; it aggregates per-item failures and exits nonzero if any selected item fails.

Dark is the default presentation. Light-theme state fixtures use the same canonical markup and choreography. Local posters/videos are regenerated from `demo.html` only after canonical/demo parity passes.

Manifest descriptions are updated where necessary to describe the final HyperFrames component accurately. Stale claims such as “shadcn-style,” duplicated source-brand references, and unsupported-state claims are removed. Manifest names, tags, types, target paths, and preview URL shape remain stable.

## 11. Implementation sequence

1. Freeze the 66-item allowlist and generate the baseline public-contract snapshot.
2. Add the token/motion source of truth, synchronization script, and parity/forbidden-style tests.
3. Implement and review representative pilots: `button`, `input`, `select`, `switch`, `dialog`, `popover`, `toast`, `table`, `chart`, `skeleton`, and `spinner`.
4. Roll the approved system through controls and forms.
5. Roll it through navigation, disclosure, and structural primitives.
6. Roll it through overlays, feedback, loading, and data primitives.
7. Finish specialized/meta entries, including `blur-in`, `caret`, `cursor`, `registry`, and `remocn-ui`.
8. Synchronize every canonical region into its demo and update accurate manifest copy.
9. Generate dark/light/state/responsive contact sheets and local catalog previews.
10. Run scope, compatibility, accessibility, deterministic-rendering, format, lint, build, test, and visual-review gates.

The pilots are an internal system-consistency checkpoint, not a new direction decision. Implementation proceeds without reopening approved visual choices.

## 12. Verification gates

### 12.1 Automated gates

- Exact allowlist remains 66 and matches Appendix A.
- Every ID has its canonical file, demo, and manifest.
- Public-contract comparison reports zero removals or renames.
- Canonical/demo normalized hashes match for all 66.
- Dark/light computed layout properties match except for approved theme tokens.
- State fixtures cover every documented state or an explicit `N/A`.
- The existing Puppeteer harness plus pinned `axe-core` fixtures assert role/name/state, contrast, focus visibility, hidden-overlay removal, and `scrollWidth <= clientWidth` in both themes.
- In live preview mode, computed CSS transitions assert exact `210ms` anchored-overlay entry and `140ms` exit with the approved curves. In deterministic render mode, computed CSS transition/animation duration is zero while registered GSAP segments assert `0.21s` entry and `0.14s` exit; modal/drawer tiers use their named values.
- Responsive fixtures have no accidental horizontal overflow or overlapping coarse-pointer hit areas.
- Determinism scans find no prohibited runtime dependency, and three sequential plus one shuffled capture pass produce matching frame hashes.
- Style lint rejects gradients, decorative backdrop blur, `transition: all`, `scale(0)` entrances, `back.out`, unsupported weights/radii, and improvised control glyphs.
- Semantic exceptions are explicit and selector-scoped.

Repository checks:

```bash
bunx oxfmt --check <changed-files>
bunx oxlint <changed-ts-files>
bun run build
bun run test
bun run lint
bun run format:check
```

For every changed demo, preserve an assembled preview workspace and run HyperFrames lint and runtime validation inside it:

```bash
bunx tsx scripts/generate-catalog-previews.ts \
  --type component --only <id> \
  --prepare-only tmp/operator-black/<id> --keep-workspace
(cd tmp/operator-black/<id> && npx hyperframes lint && npx hyperframes validate)
```

Preview generation must succeed per item and for the frozen allowlist. The full run must report exactly 66 selected items and 66 successful outputs:

```bash
bunx tsx scripts/generate-catalog-previews.ts --type component --only <id>
bunx tsx scripts/generate-catalog-previews.ts \
  --type component \
  --allowlist registry/ui-primitives/operator-black.scope.json
```

### 12.2 Manual visual gates

Manual evidence is split into reviewable artifacts:

- one base sheet showing all 66 primitives in dark and light;
- one state sheet per component family;
- one risk-based resilience sheet covering every family plus every exceptional primitive at narrow width, long copy, RTL, and reduced motion.

The full responsive/content/direction/motion matrix remains automated rather than producing thousands of manual thumbnails.

Reviewers verify:

- crisp one-pixel edges at native size and enlarged video-preview scale;
- consistent icon alignment and stroke weight;
- no one-off visual language;
- no decorative mint, gradients, glass, or nested-card composition;
- obvious relationships among controls, overlays, data, and feedback;
- physical press response and correctly anchored, asymmetric motion.

## 13. Definition of done

The goal is complete only when all 66 canonical snippets and demos implement Operator Black, preserve the frozen public contract, pass every automated gate, and receive a final contact-sheet review with no unexplained visual exception.

## Appendix A — Frozen 66-item allowlist

```text
accordion
alert
alert-dialog
aspect-ratio
avatar
backdrop
badge
blur-in
breadcrumb
button
button-group
calendar
card
caret
carousel
chart
checkbox
collapsible
combobox
command-menu
command-menu-item
context-menu
cursor
dialog
drawer
dropdown-menu
dropdown-menu-item
empty
field
hover-card
input
input-group
input-otp
item
kbd
label
menubar
native-select
navigation-menu
pagination
popover
progress
progress-steps
radio
registry
remocn-ui
resizable
scroll-area
select
select-item
separator
sheet
sidebar
skeleton
skeleton-block
slider
spinner
stepper
switch
table
tabs
textarea
toast
toggle
toggle-group
tooltip
```
