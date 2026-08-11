# Contributing a Block or Component to the Registry

Guide the user from idea to merged PR for a new registry block or component.

## Workflow

```
1. Clarify → 2. Scaffold → 3. Build → 4. Validate → 5. Preview → 6. Ship
```

### Step 1: Clarify

Ask what they're building. The registry has two item types:

- **Block** (`registry/blocks/`, type `hyperframes:block`) — a full standalone composition with fixed dimensions and duration. Caption styles, VFX effects, title cards, lower thirds.
- **Component** (`registry/components/`, type `hyperframes:component`) — a reusable snippet with no fixed dimensions or duration. CSS effects, text treatments, overlays that adapt to any composition size.

Then ask:

- One-sentence description of the effect
- Visual reference (URL, screenshot, or description)
- Who uses this and when?
- **Which controls does the user get?** Name each and say what it drives — at least 2 declared controls total (family base included); at most 4 item-specific controls beyond the base. If you can't name them yet, you aren't ready to scaffold.

### Step 2: Scaffold

Create the registry structure:

**For blocks:**

```
registry/blocks/{block-name}/
  {block-name}.html
  registry-item.json
```

**For components:**

```
registry/components/{component-name}/
  {component-name}.html
  registry-item.json
```

**Naming convention:**

| Item name        | ID prefix | Example IDs            |
| ---------------- | --------- | ---------------------- |
| `cap-hormozi`    | `hz`      | `hz-cg-0`, `hz-cw-3`   |
| `cap-typewriter` | `tw`      | `tw-cg-0`, `tw-ch-0-5` |
| `vfx-chrome`     | `vc`      | `vc-canvas`            |

Use a 2-3 letter prefix. ALL element IDs must use this prefix to avoid collisions in sub-compositions.

**registry-item.json** — use the canonical templates in [templates.md](templates.md) (block and component variants, both with all required fields).

### Step 3: Build

Apply the correct template based on type. See [templates.md](templates.md) for copy-paste starters.

#### Caption blocks

**Non-negotiable caption rules:**

- Font: **96px minimum** for proportional fonts. **64-72px acceptable for monospace** (wider characters need less size).
- Readability: `-webkit-text-stroke: 2-3px` OR multi-layer `text-shadow`
- Overflow: call `window.__hyperframes.fitTextFontSize()` on every group
- Karaoke: highlight active word via `tl.to(wordEl, { color/scale }, WORDS[wi].start)`
- Hard kill: `tl.set(groupEl, { opacity: 0, visibility: "hidden" }, g.end)` on EVERY group
- **Never use `tl.from(el, { opacity: 0 })` at the same position as `tl.set(el, { opacity: 1 })`** — the from clobbers the set. Use `tl.to` instead.

**Per-character animation** (typewriter, scramble):

- Wrap each character in `<span>` with ID `{prefix}-ch-{group}-{char}`
- Stagger via `tl.set` at computed intervals from word timestamps
- Cursors/decorative elements: use `tl.set` at intervals — NOT CSS animation (not seekable)

**Positioning variants:**

- Centered: `display: flex; align-items: center; justify-content: center;`
- Lower-third: `position: absolute; bottom: 100px; left: 0; width: 100%; text-align: center;`
- Left-aligned: `position: absolute; bottom: 100px; left: 120px; text-align: left;`

#### VFX blocks (Three.js)

- Use `three@0.147.0` from CDN (global script)
- `tl.eventCallback("onUpdate", renderScene); renderScene();` — NO requestAnimationFrame
- State proxy pattern: GSAP animates plain JS object, render function reads it
- Seeded PRNG (`mulberry32`) for randomness

#### All types

- **Placeholder content is monochrome** — read
  [placeholder-material.md](placeholder-material.md) before choosing a single colour. Stand-in
  screens, images, cards, avatars, logos and chart series use four alpha steps of the
  composition's ink; accent marks one element and never a placeholder.
- `data-composition-id` MUST match `window.__timelines["id"]`
- All element IDs prefixed with block abbreviation
- `gsap.timeline({ paused: true })` — always paused
- No `Math.random()`, no `Date.now()`

#### Control surface

Every registry item ships a **designed control surface** of meta-controls, declared in the item's top-of-script `CONFIG` object. The budget: **at least 2 declared controls total (family base included); at most 4 item-specific controls beyond the base** (see the reserved-controls law). For items carrying a family base, the base alone already satisfies the floor; the floor bites only for baseless items. Everything that is not a meta-control, not content, and not the documented `--<prefix>-*` token layer is **locked** — reachable only by editing the item source.

**Design precedent.** This is the rigging model used by NLE motion templates: Apple Motion rigs map one or more parameters at preset values to a single control ("widget"), record parameter states as snapshots behind three widget types (checkbox = 2 states, pop-up menu = N discrete states, slider = interpolated states), and review the published set in one place (Project Inspector → Publishing pane). Apple names two co-equal uses for rigging — letting users modify a complex group of parameters with a small set of controls, and limiting user control so that work adheres to established specs; this convention adopts both, with the second as the gate's job (Apple Motion User Guide: support.apple.com/guide/motion — intro-to-rigging `motn13f20610`, how-does-rigging-work `motn13f20579`, adding-controls-to-templates `motn141bd07d`, publish-rigs `motn13f21017`). Motion offers four publishing postures, from a nonmodifiable preset through publishing specific raw parameters to publishing rig widgets (`motn141bd07d`); this convention mandates the rig-widget posture exclusively. It is also stricter than Motion in one respect: Motion permits single-parameter rigs, but here a control must drive a designed state group or route through a mapping — renaming one raw number designs nothing.

**What counts, what doesn't:**

- **Content is not a control** and is uncounted: text strings, data arrays/rows/series, data scalars (a value the item displays, or a progress datum the host animates — the datum shown, not a feel lever), and media wired through HyperFrames variables. This is the drop-zone/text-field layer — always editable.
- **Tokens are not controls**: the item's `--<prefix>-*` CSS custom properties are the host re-skin layer (override at host level). Never surface an individual token value as a per-item control, and never hard-code a hex. (A `scheme` control selects among _authored token sets_ — a variant pose over the token layer, not a token-value surface; host token overrides apply on top of whichever set is selected.)
- **Locked by default**: durations, eases, staggers, seeds, per-axis raw tween values, timeline structure, per-frame callbacks. If it isn't a declared control and isn't content, changing it requires editing the item.

**Three control types** (the widget analogy, one-to-one):

| Type      | Motion analog   | Contract                                                                                                                                                                                                                                                                                                           |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `toggle`  | checkbox widget | Boolean between two authored states. Both states rendered and checked.                                                                                                                                                                                                                                             |
| `variant` | pop-up widget   | Enum over N authored poses. Every pose rendered and checked.                                                                                                                                                                                                                                                       |
| `scalar`  | slider widget   | Bounded number (prefer unit-free `0..1`) interpolating between authored anchor states **through a lookup table or feel API** — never landing raw in a tween arg. The displayed range is presentation; the mapping owns real values. Choose the interpolation per segment (stepped / linear / eased), deliberately. |

**Mapping laws:**

1. One control drives N underlying parameters — a control may drive any number of them.
2. Each underlying parameter is driven by **at most one** control — no two controls contending over the same value (Motion's rule, verified: a parameter cannot be controlled by two widgets simultaneously — `motn13f20579`). **Composition carve-out** — this convention's own extension, consistent with that rule: a scalar may modulate another control's _authored output_ (e.g. an amount scaling a chosen preset bundle); it drives the primary control's output, never the raw parameter, so no parameter ever sits under two controls. When composing, keep exactly one canonical spelling per state — a modulating scalar must not be able to re-spell a state the primary control already names (make it inert or floored there).
3. **No raw passthrough.** Control names state intent (`energy`, `layout`, `boil`, `move`), never implementation (`staggerMs`, `easePower`, `ampPx`). If a control's value reaches a tween argument unchanged, it is passthrough — route it through an adjective→number table or a feel API (e.g. a spring-feel factory: adjective in, curve out; rate-preset bundles).
4. **Every reachable state is authored.** Each toggle state (every combination for a paired toggle — four for a pair), each variant pose, and scalar endpoints + midpoint must be rendered and looked at before ship. A state nobody rendered is not designed. Scalars that couple to placed-clip duration (rates, travel) must have their max state checked at the longest plausible placement, not just demo length. Evidence accompanies the PR: a state contact sheet (one snapshot per required state, e.g. via `hyperframes snapshot`) or the exact render commands listed in the PR body (audited by the Quality Gate).
5. **Controls are bounded like widgets.** A Motion slider physically cannot exceed its tags (`motn13f20a96`); a `CONFIG` object accepts anything, so boundedness must be built: an unknown variant value falls back to the declared default; an out-of-bounds scalar clamps to the nearest declared bound; both log a console error and render an authored state (the error surfaces in `hyperframes check`'s 0-console-errors gate). An out-of-range input fails loudly into an authored state, never silently into an unauthored one.
6. **Determinism holds.** Controls must not break the build laws above (paused timeline, no `Math.random()`, no `Date.now()`). Host-inspector conveniences like sequential/random default-cycling are prohibited; seeds stay locked inside the item.
7. **Reserved controls.** An item exposing a color-scheme flip, entrance/exit toggles, or a line-boil pose MUST use the established names, shapes, and counting rules: `scheme` (variant over authored token sets; the default is the family's shipped scheme, recorded in the family spec; precedence: a host `--<prefix>-*` token override applies **on top of** the scheme-selected set), `animationIn`/`animationOut` (a paired toggle counting as **one** control; all four combinations are reachable states and must be authored), `boil` (variant; poses are authored amp/rot pairs over a family-locked `frameDrop`). **Family-base controls** — controls a family spec stamps identically on every item in a set of related items — do not consume the 4-slot item-specific cap, though they do count toward the 2-control floor (Motion analog: the marker-generated, template-wide Build In/Build Out checkbox appears in the template's Published Parameters list without occupying any rig widget — `motn141bc9de`). **Floor waiver:** when a family-base control is structurally inapplicable to an item class (e.g. a static 1-frame card with no entrance/exit timeline), the floor is satisfied by the applicable subset — state the inapplicability in the item's CONFIG comment block instead of inventing a filler control.

**Components:** a component snippet ships a CONFIG-reading helper; the host wires it into its timeline with a _position only_ (e.g. `tl.add(sweepBuild(el), "<position>")`). The helper owns its durations, eases, and staggers internally, mapped from the component's declared controls — raw tween args never migrate into host code. The parent composition owns _where_ the component sits on the timeline; the component owns _how_ it moves.

**CONFIG shape and comment grammar:**

```js
var CONFIG = {
  // ── Content (freely editable — not counted) ─────────────────────
  title: "Quarterly usage",
  rows: [{ label: "Renders", value: "1.2M" }],

  // ── Controls (≥2 total incl. family base; ≤4 item-specific — the only levers; comment grammar is mandatory) ──
  scheme: "light", // variant: "light" | "dark" — selects the authored token set (default = the family's shipped scheme)
  layout: "3up", // variant: "2up"|"3up"|"4up"|"3x2"|"1+2" — grid pose + per-cell inside scale (5+ params)
  animationIn: true, // toggle: entrance on/off — durations derive from DUR, never exposed
  animationOut: true, //   (pairs with animationIn; the pair counts as one control)

  // ── Locked (edit the item source to change) ─────────────────────
  // eases, staggers, seeds, per-axis rates, timeline structure
};
```

Comment grammar, one line per control: `// <toggle|variant|scalar>: <values> — <what it drives (param count)>`. This comment block **is** the item's published-parameter list; reviewers and the Quality Gate read it, and it must agree with the `controls` declaration in `registry-item.json`.

### Step 4: Validate

```bash
hyperframes lint                    # 0 errors required
hyperframes check --no-contrast  # 0 console errors required
```

### Step 5: Preview

```bash
# Render preview video
hyperframes render -o preview.mp4

# Snapshot for visual QA
hyperframes snapshot --at "1.0,3.0,5.0,7.0"

# Publish to hyperframes.dev for review
npx hyperframes publish
```

**Catalog preview image** — The catalog card uses a PNG at `docs/images/catalog/{kind}/{name}.png` (where `{kind}` is `blocks` or `components`). Generate it from a snapshot, then:

- **HeyGen internal contributors:** run `scripts/upload-docs-images.sh` (requires AWS profile `engineering-767398024897`)
- **External contributors:** attach the preview MP4 to your PR description. A maintainer will generate and upload the catalog image before merging.

### Step 6: Ship

**All steps are required. Missing any one produces a broken catalog entry.**

`{kind}` is `blocks` or `components` depending on what you built in Step 1.

```bash
# 1. Create branch
git checkout -b feat/registry-{name}

# 2. Format HTML
npx oxfmt registry/{kind}/{name}/*.html

# 3. Regenerate registry/registry.json from the item directories.
#    Do not hand-edit it: an entry added by hand survives until the next
#    regeneration and then vanishes, and one left behind for a directory that
#    no longer exists is worse, because `hyperframes add <name>` resolves the
#    name and then fails on missing files.
npx tsx scripts/generate-registry-items.ts

# 4. Generate catalog docs page
npx tsx scripts/generate-catalog-pages.ts

# 5. Publish to hyperframes.dev so reviewers can preview
npx hyperframes publish

# 6. Stage everything
git add registry/{kind}/{name}/ registry/registry.json docs/catalog/

# 7. Commit
git commit -m "feat(registry): add {name} — {one sentence}"

# 8. Push and open PR with hyperframes.dev link
git push origin feat/registry-{name}
gh pr create --title "feat(registry): {name}" --body "preview: {hyperframes.dev-url}"
```

**If you don't have a GitHub account:** you need one to open a PR. Sign up at https://github.com/signup, then run `gh auth login`.

## Quality Gate

- [ ] `hyperframes lint` → 0 errors
- [ ] `hyperframes check` → 0 console errors
- [ ] `npx oxfmt --check` passes
- [ ] `registry/registry.json` updated with new entry
- [ ] `scripts/generate-catalog-pages.ts` run (docs page generated)
- [ ] `npx hyperframes publish` run (claim your project URL)
- [ ] Preview MP4 attached to PR (external) or catalog PNG uploaded (internal)
- [ ] All IDs unique and prefixed
- [ ] Control surface budget in `CONFIG`: at least 2 declared controls total (family base included); at most 4 item-specific controls beyond the base; typed (toggle/variant/scalar) with the comment grammar; no raw duration/ease/stagger/seed/hex passthrough
- [ ] Locked-by-default verified: every `CONFIG` key is a declared control or a content field; every CSS custom property the item consumes is a documented `--<prefix>-*` token; one spot-edited locked value confirmed changeable only by editing the item source
- [ ] Every control state authored: each toggle state (all four combinations for a paired toggle), each variant pose, scalar endpoints and midpoint rendered and checked — evidenced by a state contact sheet (one snapshot per required state) attached to the PR, or the exact render commands listed in the PR body
- [ ] Invalid control value tested: an unknown variant value falls back to the declared default; an out-of-bounds scalar clamps to the nearest declared bound; both log a console error and render an authored state
- [ ] Controls declared in `registry-item.json` `controls`, agreeing field-for-field with the `CONFIG` comment block
- [ ] Generated catalog page shows the controls table (`scripts/generate-catalog-pages.ts` re-run with the controls-table extension; `docs.json` nav updates automatically)
- [ ] `demo.html` shows at least one non-default control state (components); for blocks, the preview MP4 / catalog states show one — or an optional block `demo.html` does

### Control-surface audit (reviewer notes)

1. **Budget present and designed.** Open the item's script. Count the entries in the CONFIG controls section (comment grammar `// <type>: <values> — <what it drives>`). The rule: at least 2 declared controls total (family base included); at most 4 item-specific controls beyond the base. `animationIn`+`animationOut` count as one; family-base controls (e.g. `scheme`, the animation pair) count toward the 2-total floor but not the 4-slot item-specific cap; content fields (text, data arrays, HyperFrames media variables) and `--<prefix>-*` tokens count as zero. A base control declared structurally inapplicable in the CONFIG comment block is waived per the convention's floor waiver — not filler-required. Below the floor or over the cap → fail.
2. **No raw passthrough.** Grep the item for implementation-named `CONFIG` property keys — match `^\s*(dur|ease|stagger|amp|seed|rot|frameDrop|delay|rate|speed)\w*\s*:` inside the CONFIG object, plus bare hex literals in CONFIG values. Comments and `--<prefix>-*` token names are excluded (the comment grammar and token layer legitimately name these words). A control value that reaches a tween argument unchanged is passthrough → fail; it must route through a lookup table or feel API. (The grep is a heuristic — the governing test remains whether a control value reaches a tween argument unchanged.)
3. **Locked-by-default.** Cross-check the CONFIG comment block against `registry-item.json` `controls` — they must agree exactly (for a `fields` control, match on the union of its fields). Then spot-edit: pick one locked value (an ease, a stagger, a seed) and confirm the only way to change it is editing the item source — no undeclared CONFIG field, no undocumented CSS variable acting as a hidden knob.
4. **Demo'd.** Components: open `demo.html` (the `<name>-demo` composition) and confirm at least one control is shown in a non-default state — side-by-side instances or sequential states within the 5-8s demo. Blocks: not required to ship demo.html (demo-html-pattern.md — several shipped blocks carry one anyway); when absent, the preview MP4 / catalog states must show a non-default control state; when present, it may satisfy the check the same way a component demo does. For scalars that couple to placed-clip duration (rates, travel), confirm against the state contact sheet (or listed render commands) that the max state was checked at the longest plausible placement, not just demo length.
5. **Documented.** The item's auto-generated catalog page (`docs/catalog/{kind}/{name}.mdx`) renders a controls table matching the `controls` declaration field-for-field (name, type, values, default, drives). `docs.json` is the Mintlify site config — its nav is updated by the codegen, never by hand; the check here is on the generated page's content.
6. **Bounded.** Probe one control of each declared type with an out-of-range value: an unknown variant value falls back to the declared default; an out-of-bounds scalar clamps to the nearest declared bound; both log a console error and render an authored state — loud fallback/clamp, never a silent unauthored render. The probe is a temporary modification (or runs on a scratch copy), reverted before the lint/check boxes are evaluated.
