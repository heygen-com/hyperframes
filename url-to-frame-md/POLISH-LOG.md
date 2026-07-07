# Showcase polish log

Reviewer-driven iteration on the URL → frame.md → showcase pipeline. Each cycle = one
verified increment. Canonical toolkit home: experiment-framework PR #41000 — push these
source changes there when reviewed.

## Cycle 12 — SVG density on bare beats + avatar frames

Reviewer + user feedback: frames 1-3 were bare (wordmark / big text / lone number) — unrealistic for a video-agent — and there were no avatar frames.

- cover -> SVG system emblem; claim -> oversized SVG quote-mark; stat -> real SVG area chart (grid + area + line + points), not a lone number.
- New **avatar-support** (presenter as ground + supporting bar-viz) and **avatar-overlay** (PiP bug + lower-third over a stat beat), from a bundled brand-agnostic portrait, accent-tinted per site.
- Sheet now 12 frames. All 15 verify+render green.

## Cycle 1 — ground inversion, font poison, swatch legibility

Reviewers (opus/linear/snowflake/elevenlabs, comparing `showcase.png` vs
`screenshots/contact-sheet-1.jpg` vs `frame.md`) flagged three systemic showcase bugs.
All three fixed and verified across all 11 sites (verify-green; visual spot-check on
stripe/elevenlabs/snowflake=light, opus/linear=dark).

1. **Italic font poisoning** (`lib/fonts.mjs`). Linear ships `InterVariable-Regular.woff2`
   whose _content is italic_ (manifest `style: italic`) plus the true upright
   `InterVariable.woff2`. Two-layer fix:
   - skip italic files on read (`isItalicFile`: manifest style or /italic|oblique/ name);
   - **stage with an unconditional copy** — the old `if (!existsSync)` guard let a stale
     poisoned clean-named file from an earlier run survive forever (staging writes into
     the same dir it reads). Re-copying the correctly-chosen source each run is idempotent
     for good files and self-heals poisoned slots.
     → Linear display/hero now upright Inter.

2. **Gallery ground inversion** (`render-showcase.mjs`). The doc chrome was hardcoded
   `#0e0e0e`, so light-first brands (ElevenLabs cream, Snowflake/Stripe white) rendered as
   a dark board. Now derived from brand luminance: `darkGallery = lumOf(canvas) < 128`;
   light brands get `shade(canvas,-8%)` ground + dark doc text; dark brands keep `#0e0e0e`.
   Section heads, rails, frame shadows, and the Chrome `--default-background-color` all
   follow the same polarity.

3. **Invisible swatches + muddy labels** (`render-showcase.mjs`). Every `.sw .chip` now
   gets a luminance-aware inset hairline (dark-on-dark / white-on-white chips were
   vanishing). Muted label opacities bumped .5→.68/.7 (`.sm code`, `.tmeta span`,
   `.cnote`, rail attrs).

## Cycle 2 — gradient/mesh capture (engine) + accent proportion + offline re-extract harness

All 5 reviewers (stripe/elevenlabs/opus/heygen/snowflake) converged: the #1 essence loss is the
site's signature **gradient/mesh background** (flat spec-sheet vs. brand color wash), and #2 is the
**accent overstatement** (giant stat numbers in accent). Both fixed end-to-end; all 11 verify-green.

1. **Engine gradient capture** (`designStyleExtractor.ts` + `types.ts`). `getStyles` now records
   gradient `backgroundImage` (url()/none dropped) and `backdropFilter`; button/card/nav keep those
   in their dedup keys so a gradient/frosted variant survives. New page-level collector scans large
   elements **+ `::before`/`::after` pseudo-elements** (hero orbs are often pseudo) and returns the
   top washes ranked by **chroma-weighted area** (a vivid brand wash beats a bigger neutral scrim).
   Result: Stripe's signature `radial-gradient(circle,#7F7DFC,#F44BCC 33%,#E5EDF5 66%)` mesh is
   captured and now grounds the cover — instantly reads as Stripe.

2. **Offline re-extraction harness** (`reextract-design.mjs`). Dependency-free Chrome DevTools
   Protocol client (Node 22 global `WebSocket`/`fetch`) that re-runs the _actual_ engine script
   (sourced from `designStyleExtractor.ts`, single source of truth) against the saved
   `extracted/page.html` — validates engine changes across all 11 captures with **no live network**.
   **MERGE-ONLY**: it writes back only `backgrounds`. Hard lesson: an early version overwrote the
   whole `design-styles.json`, and offline typography _degrades_ (the saved "stable HTML" lacks some
   runtime styling, so unstyled elements inherit headless Chrome's default face → "PingFang SC" /
   stray non-brand fonts leaked into 3 sites and failed verify). Gradients read from inline
   `background-image` and ARE offline-faithful; typography is not. (Verified: stripe offline
   typography is byte-identical to its live backup — the leak only hits roles the saved CSS didn't
   style.)

3. **Generator** (`build-frame-from-capture.mjs`). Emits a `gradients:` token block (verbatim,
   CSS-valid, trailing `, none` layer stripped). New font guard: any typography font **not in the
   captured brand set** is normalized to the brand primary (was only catching CSS generics) — fixes
   the offline fallback leak _and_ is a genuine robustness win (a role in a system font isn't
   brand-meaningful). Keeps frame.md fonts ⊆ captured, so verify's L2 font gate holds.

4. **Renderer** (`render-showcase.mjs`). Paints the cover ground with the most chromatic captured
   gradient; adds a "Backgrounds" proof strip (shows exactly which washes were captured); stat
   numbers now render in **ink** (accent reserved for eyebrow + one emphasized word), per all 5
   reviewers. `run-all.sh` = canonical refresh (re-extract → generate → render → verify).

Honest limits this cycle: ElevenLabs/HeyGen hero _auras_ are canvas/WebGL (or below the area
floor), not CSS gradients — their captured washes are faint edge-scrims/glass fills, so no dramatic
cover ground (correct, not forced). Opus/DoorDash are genuinely flat (0 gradients). `backdrop-filter`
came back empty because the frosted panels aren't in the card/nav selectors (see backlog).

## Cycle 3 — primary-CTA identity + card elevation + alpha-drop fix

All 5 reviewers' #1 gap was an **inverted primary CTA**: the generator picked the wrong button as
`button-primary`. No cycle-2 regressions (gradient cover + accent dial-back confirmed good). All 11
verify-green; CTA fixed on 5/6 flagged sites (visually confirmed).

Root causes + fixes:

1. **Primary CTA chosen by "closest to accent"** — fails for brands whose CTA is a high-contrast
   _neutral_ pill (ElevenLabs black, Opus white, HeyGen dark) rather than the accent hue.
   → Generator: `fillProminence` ranks by `max(accent-closeness, canvas-contrast)` among solid fills,
   with a pill-radius tie-break and gradient fills scored top. `radiusRef`/dedup now key on pill-vs-
   square so a pill and a same-fill square stay distinct (Opus's white pill no longer collapses).

2. **Primary CTA lived in the nav/header** (`Sign up`, `Start for free`) — the engine dropped all
   `<nav>` descendants. → Engine: keep nav elements that are _filled_ (solid OR gradient), still
   dropping plain text links. Widened button sampling (10→16, keep 6 variants).

3. **Alpha-drop bug** (`rgba(…,0)` → `#000000`) turned every transparent wrapper into a phantom
   black button/card and dropped real CTAs as bg==text. → Engine `rgbToHex` returns `transparent`
   for zero-alpha; the generator already treats a transparent ground as no-fill (canvas). This is
   foundational (also unblocks translucent/glass fills later). Fixed ElevenLabs/Opus CTA capture.

4. **Cards read flat** — shadow tokens captured but the representative `card` often had `shadow:none`.
   → Generator: sort captured cards shadow-first; if the lead card is flat but the site has a strong
   global elevation shadow (blur ≥ 16px), graft it. Renderer: a card with no captured border/shadow
   gets a faint inset hairline so dark-on-dark / white-on-white surfaces read (spec unchanged).

5. **Faithful component fills** — `groundToken` now emits a literal hex when the fill is far from any
   palette role (a `#0D1117` near-black pill or `#FFFFFF` pill keeps its true fill, not a greyer role).

Harness is now **preserve-typography, take-offline-for-CSS-fields** (buttons/cards/nav/shadows/
backgrounds are CSS-deterministic offline; only the typography ramp degrades offline, so it's kept).

Honest limit: **Snowflake's blue pill** uses a gradient on an inner element/pseudo the button
selector doesn't reach, so its CTA still renders as a plain surface. Generator + renderer now fully
support gradient-filled CTA tokens (works the moment the gradient is captured on the button) — the
remaining gap is engine selector/pseudo reach. Queued below.

## Cycle 4 — frosted glass (backdrop-filter) + synthesized accent-pill CTA

Reviewers' remaining HIGH items: glass/backdrop-filter (HeyGen hero prompt box, Stripe floating
chrome) and Snowflake's still-missing blue pill. Both shipped; all 11 verify-green; visually
confirmed. Verified `backdrop-filter` DOES rasterize under headless Chrome `--disable-gpu` (tested on
a synthetic page) before investing.

1. **Glass capture (engine).** New page-level collector scans elements with `backdrop-filter: blur`,
   records the RAW translucent fill (rgba/gradient — alpha intact, since `rgbToHex` would drop it) +
   blur + border + radius + shadow, ranked by area → `glass[]`. Captured: HeyGen `blur(24px)
saturate(4)`, Stripe `blur(12px)`. (Bug caught mid-cycle: the collector ran but `glass` was
   missing from the extractor's return object — proven via a synthetic backdrop-filter page, which is
   also a good regression fixture.)

2. **Glass material (generator + renderer).** Generator emits a `glass-panel` token (verbatim
   translucent fill + `backdropFilter` + border + radius + shadow). Renderer applies
   `backdrop-filter` in component CSS and adds a **Materials** section that floats the glass panel
   over a colored ground (a translucent fill on flat white is invisible — it needs something to
   frost over). HeyGen/Stripe showcases now show a real frosted-glass panel.

3. **Synthesized accent-pill CTA (generator).** When extraction finds no usable filled CTA (all
   captured buttons are transparent text-links — e.g. Snowflake's blue pill lives on a child the
   selector misses), the generator now synthesizes the brand's real CTA pattern: **accent as a filled
   pill** (accent + pill radius are captured atoms; only their composition is inferred). Light text
   on accent picks the lighter palette neutral. Snowflake now renders its signature electric-blue
   pill. All 5 reviewers had explicitly endorsed this floor.

Offline-harness note reaffirmed: glass reads straight from CSS on visible elements, so it IS captured
offline where those elements render (HeyGen/Stripe). Elements that are purely JS-gated (some auroras)
still need a live capture.

## Cycle 5 — chromatic heading colors (systemic) + broadened review coverage

Reviewed the LESS-examined captures (livekit/descript/bmw/kuse) + an aura check on elevenlabs, to
find systemic gaps rather than re-polish the same 5 sites. Top systemic bug (Descript, confirmed in
code): **a brand-inked heading color was snapped to the generic `ink` token** — Descript's maroon
`#390A1A` display/heading/hero rendered near-black, killing its editorial maroon-type signature.

Fix (generator, offline-verifiable, affects every site): `typeColorToken` preserves a heading's
captured color as a **literal hex** when it's a genuine brand chroma, gated by two guards so it can't
misfire:

- **Legibility** — the color must contrast the canvas (Δlum ≥ 50); a dark-on-dark mis-sample (Opus's
  `#24235E` input-placeholder color) falls back to `ink`.
- **Corroboration** — a distinct chromatic color is kept only if ≥2 heading roles share it, so a
  consistent ramp (Descript maroon ×3) survives while a lone outlier (one stray green `#81B81A` h1
  among Stripe's navy headings) is rejected as a mis-sample.
  Renderer resolves a type color as a CSS var (role key) OR a literal hex. Result: Descript now renders
  its maroon headings; Stripe/Opus unchanged (correctly neutral). All 11 verify-green.

## Cycle 12 — asset frames (element + background) + centered motion-graphic beats

User direction: a real video-agent frame almost always carries an ASSET (a photo as a masked
element or a full-bleed background) — pure motion-graphics is the exception — and pure-drawn beats
are **centered** (one focal, symmetric, negative space), NOT PPT (left-aligned title + editorial
rails + content columns). Our composed sheet was all drawn + all wearing editorial left/right rails
(kicker/ref top, caption + LIVE dot bottom) → read as a slide deck, not a moving frame.

Renderer (`render-showcase.mjs`):

- **Two asset frames.** `assetElFrame` — a circular-masked hero (accent ring + dashed orbit) anchoring
  an off-center split with a kicker + oversized headline + two icon-pill badges (mirrors a real
  video-agent scene). `assetBgFrame` — full-bleed hero under a darken+accent scrim with centered type.
  Uses a general, brand-agnostic bundled demo asset (`assets/demo-hero.jpg`, a neutral abstract 3D
  render) inlined as a data-URI → self-contained + deterministic; the accent ring/scrim are
  brand-derived so each site tints it (amazon yellow, anthropic terracotta, …). Graceful fallback to
  a drawn beat if the asset is missing.
- **Centered beats + de-PPT'd chrome.** `cxFrame` dropped the editorial top/bottom rails; the frame
  is now just a centered focal (the outer cell caption does the labeling). `.cx-main` centers content
  (align-items + text-align). Cover / claim / stat / comparison / flow all read as centered
  motion-graphic beats.
- Sheet is now 7 composed + focal = 8 cells (4 rows; `SHEET_CELLS` + the row-budget from cycle-11's
  Codex fix keep the PNG un-clipped). Portrait uses the full-bleed asset (fits 9:16) not the split.

Verified: all 15 verify+render green; spot-checked amazon (navy+yellow ring) + anthropic (cream +
terracotta ring, serif centered beats) — matches the reference video-agent frame the user shared.

## Cycle 11 — box-shadows captured by computed style, not class-name selectors

Reviewers (stripe + vercel, HIGH) both hit `shadows: []`: the sampler selected elements by class-name
substring (`[class*='card']`, …), which utility/obfuscated class names never match, so all card
elevation was lost and the renderer faked a heavy off-brand drop shadow. Fix (ENGINE,
`designStyleExtractor.ts`): sweep a broad structural set of visible, card-sized boxes and collect
their real computed `box-shadow`; the shadow recurring on the most boxes is the elevation signature
(skips tiny + full-bleed wrappers). Live re-capture: Stripe `[]`→5 (incl. the signature
`rgba(50,50,93,0.12) 0 16px 32px`), Vercel `[]`→3. Shipped as hyperframes PR #1883. Backlog:
`cards: []` shares the same class-selector root cause; ElevenLabs glass/aura live on
pseudo-elements/canvas; Snowflake CTA picks text-links over the filled pill.

## Cycle 10 — data-driven grounds (dark footer navys) + universal icons + 大气 frames

User feedback on the amazon showcase: (1) "footer 有两个灰色你都没拿到" — Amazon's footer
navys never surfaced; (2) the composed frames are "太简单…不够大气" (too simple / not grand);
(3) "图标感觉不通用" (the hand-drawn icons feel domain-specific). Root cause + one increment:

1. **Grounds were structurally light-only.** The single `surface` role required
   `|Δlum(canvas)| < 40`, so any dark/tinted ground was impossible to hold. Amazon's `#232F3E`
   footer navy is the **3rd-largest painted area on the whole page** (maxArea 2.18M) yet was
   dropped. Fix (generator): emit a ranked **`grounds:`** block — the top distinct background
   colors by `maxArea` (real painted area), darks included, each with a best-contrast `on`-color
   and a luminance-classified `kind` (light/mid/dark/canvas) — plus a first-class
   **`surface-contrast`** role (the largest _neutral_ ground on the opposite tonal side of the
   canvas: a dark footer under a light brand, a light inversion panel under a dark brand).
   Now: amazon `surface-contrast #232F3E`, descript `#110A0D` wine-black, linear `#FFFFFF`.
2. **Renderer rotation is now DATA-driven.** `groundList` reads `grounds:` (real grounds incl.
   dark) then appends accent + ink as vivid stops, so a **dark full-bleed frame lands in every
   sheet** — the thing that makes a composed frame read as authored/大气 rather than a flat light
   card. Each frame uses the ground's authoritative `on`-color. Falls back to the role-guess for
   older frame.md.
3. **Universal icon vocabulary.** Replaced the domain-specific `database` glyph and expanded to a
   neutral set (inbox / gear / check / grid / bolt / globe / spark + up/down/layers/target/arrow).
   Flow is now `input → process → output` (inbox→gear→check); comparison is a domain-free
   amplify/reduce. No icon implies a domain the brand isn't in.

**Bug caught in-cycle:** on a dark brand (linear) `surface-contrast` first grabbed `#E4F222` —
Linear's chartreuse _accent-2_ — because any far-luminance color qualified. Added a neutrality
guard (`chroma < 45` + exclude accent/accent-2). Now correctly picks the white inversion panel.

**Follow-up bug (regression from this cycle's `surface-contrast`): white-on-white button.** User:
"linear button radius … perform worse on button." Linear's real "Sign up" is a white **pill** with
**dark** text (radius 9999px was actually correct). But the extractor captured its label color as
`#E2E4E7` (near-white) on a `#FFFFFF` fill. Before this cycle, `#FFFFFF` snapped to the `ink` role
(no white role existed) so bg-role == text-role and the `visible` filter DROPPED it as invisible.
Adding `surface-contrast: #FFFFFF` gave `#FFFFFF` its own role (≠ `ink`), so the broken button now
passed `visible` and rendered white-on-white. Root fix (general invariant, not a patch): a solid-fill
button's text MUST contrast its own fill — `legibleTextToken()` snaps captured text to its role, but
if that fails contrast (Δlum < 55) against the fill, falls back to the best-contrast reading role
(ink/canvas). Now linear = white pill + dark `canvas` text = the real Sign up. Accent/dark-fill CTAs
(amazon yellow+ink, stripe violet+canvas, opus ink+surface) already contrast, so untouched.
Gradient fills keep captured text (their contrast story is their own).

Verified: regen + verify + render all **15 sites green**; visual spot-check amazon (navy+yellow,
now on-brand), linear (dark, swatch fixed, button fixed), descript (wine editorial + serif). Backlog unchanged:
pulling **real site copy** into the SVG labels (still generic "99.99%/Amplify/Reduce") is the next
biggest tell of template — separate increment.

## Cycle 9 — 3 fresh sites + radius-sentinel fix + serif-reclaim precision

Tested generality on THREE unseen, aesthetically-diverse sites (captured live, re-extracted offline
with the current engine): **vercel** (minimal black/white/blue, Geist), **clerk** (violet
gradient/glass), **anthropic** (warm cream editorial, serif). All generated + verify-green + on-brand
with no per-site tuning — Geist/Anthropic-Serif render correctly, accents right, gradients/glass
captured, giant CTA + composed focal frame all work. The toolkit now covers 14 sites.

Two fixes, both from the fresh reviews:

1. **Radius sentinel (systemic).** Chrome reports an effectively-infinite border-radius (a pill on an
   auto-width element) as `33554432px` (2²⁵). Vercel's CTA came out `rounded: "3.35544e+07px 6px 6px
3.35544e+07px"` — a garbage number. `radiusRef` now normalizes any component ≥ 2000px to `9999px`,
   so it reads as a clean pill/D-shape.
2. **Serif-reclaim over-rotation (regression fix).** Cycle 7's reclaim fired whenever
   `display === sansFont`, which is ALSO true when the display genuinely IS the brand sans — so it
   wrongly serif-ified real-sans heroes (**Linear** Inter → Tiempos, **Anthropic** Sans → Serif).
   Now it only fires when the display role's _captured_ font was a GENERIC fallback (Kuse's
   `ui-sans-serif`). Linear → Inter, Anthropic → Anthropic Sans, Kuse → Instrument Serif (still).
   `displayFamily` now follows the (possibly-reclaimed) display role, not `serifFace` unconditionally.

New backlog from the fresh reviews (low/med): glass collector ranks by area so it can pick a weak
`blur(1px)` panel over a strong one (Clerk) — rank by blur strength; a weak white CTA carrying a
near-invisible gradient overlay dodges the synth-accent path (Clerk); synth-coral CTA vs the site's
real dark button (Anthropic); Vercel wants a dark-ground frame + a mono/pixel specimen; accent-hex
disagreement between tokens and roles (Vercel #0070F3 vs #0072F5).

## Cycle 8 — font-family canonicalization (the ramp font must be a real @font-face)

Reviewer flagged BMW/Descript display type rendering as a generic fallback. Root cause (BMW,
systemic): the site's computed display font is a web ALIAS (`bmwTypeNextWeb`) while the font FILES
register under a different family (`BMWTypeNext`) — both land in `tokens.fonts` as separate brand
fonts, the type ramp picked the alias, and the alias got no `@font-face`, so the CSS matched nothing
and fell back to Arial. (Descript actually loaded fine — its "fallback" was faux-bold of a
weight-400-only face; names already matched.)

Fix (generator + lib/fonts): **stage fonts up front and snap every ramp/component font to a family
that actually renders.**

- `stageFonts` now returns `{ block, families }` — the set of `@font-face` family names it emitted
  (the ONLY names that render). Called once, early; the block is appended at the end as before.
- `fontFor` resolves a captured/computed name to a **staged** family: exact normalized match, else a
  containment match (`bmwtypenextweb` ⊃ `bmwtypenext` → `BMWTypeNext`), else the brand sans. So the
  emitted `font-family` always matches an `@font-face`.
- `sansFont`/`monoFont`/`serifFace` are now chosen from the staged families (a fallback that renders,
  not a phantom). Serif reclaim only fires for a serif that's actually staged.

Result: BMW now renders BMWTypeNext (thin grotesque), Descript its gamuthDisplay serif, Kuse/Stripe
unchanged. All 11 verify-green. Known limit: DoorDash's font files were never downloaded during
capture (`assets/fonts` empty) — nothing can render there without a re-capture (capture-level gap).

## Cycle 7 — faithful hero: serif reclaim + honest CTA (fill + geometry)

Broadened review surfaced three convergent systemic gaps (kuse + doordash); all generator-side,
offline-verifiable, all 11 verify-green.

1. **Orphaned serif hero (kuse, HIGH systemic).** A brand serif is the display/hero voice, but the
   capture sampled a generic fallback for kuse's h1 (`ui-sans-serif` → snapped to poppins) while
   Instrument Serif shipped as a loaded-but-unused brand font. Added `isSerifFont` (name heuristic,
   `!sans` guarded); when a brand serif exists and the display role fell back to the body sans, it's
   reclaimed for the display + hero ramp. Kuse now renders its editorial serif hero (+ the
   single-orange-accent-word-in-serif claim). Affects any serif-hero + sans-body brand.
2. **A low-contrast canvas pill kept as primary (kuse, HIGH).** The weak-primary check exempted any
   pill — so kuse's white "Sign up" pill (white on cream, no color hierarchy) was kept as the CTA.
   Removed the pill exemption: weakness is judged purely on canvas-contrast, so a white-on-cream pill
   is weak → synthesizes the accent (orange) pill, while Opus's white-on-DARK pill stays (high
   contrast).
3. **Synth CTA fabricated a full pill for square brands (doordash, HIGH).** The accent-pill fallback
   forced `9999px`. Now the synth radius uses the captured button radius when it has one (Kuse's pill
   survives), else a scale pill only if the brand actually carries one, else a **moderate 8px** —
   never a fabricated full pill. DoorDash (empty radius scale, ~square buttons) now gets a red
   near-square CTA instead of a wrong-brand pill.

Minor backlog from this round (low): focal-frame soft-shadow is a touch heavy for aggressively-flat
brands (DoorDash `card.shadow:none`); some captures don't emit `@font-face` so the brand display face
falls back to sans in-render (font-staging gap); kuse focal eyebrow (orange on cream) reads faint.

## Cycle 6 — Daphne integration: compose components + ground + material into one frame

Studied experiment-framework's **Daphne** agent + its **FrameMd skill** (the LLM path that turns
design.md → frame.md). Two ideas we lacked, adopted here: **frame-scale component variants** and
**"treatments compose components"** (a gradient is a Ground, glass is a material — never a loose
swatch). Prompted by the user: our standalone gradient/glass swatch strips "didn't make sense" with
the composition for the downstream video agent.

1. **Frame-scale CTA variant (generator).** Emit `button-primary-giant` — button-primary's sacred
   atoms (fill / radius / border / shadow) re-scaled to video legibility (cqw padding + a hero-ramp
   `fontSize`). A captured 32px web pill is a speck at 1920×1080; this is what a hero/plate frame
   composes.
2. **Emoji-font leak fix (generator, systemic).** `isIconFont` now also matches emoji/symbol faces —
   HeyGen's CTA had leaked `NotoEmoji` as its typography; it's now correctly SF Pro Display. Emoji
   fonts are never brand text.
3. **Composed focal frame (renderer).** The 4th composition is now a REAL frame: the captured
   **gradient as the Ground**, a floating **glass panel (or card) as the material**, and the
   **giant CTA** on top — background + material + component unified. Falls back gracefully: no
   gradient → a synthesized accent→(accent-2/lightened)→canvas aurora; no glass → the elevated card.
   The panel gets a **canvas-tinted frosted fill + elevation shadow + hairline** so it reads as a
   lifted frosted card and stays legible on any ground (reviewers caught a tone-on-tone dissolve when
   the captured glass fill matched the gradient hue — fixed universally). Backdrop-blur is kept from
   the captured glass token.
4. **Removed the standalone Backgrounds / Materials swatch strips** — their content now lives _inside_
   the focal frame, where it's used. Reviewers: net improvement, "no longer orphaned swatch rows;
   materials demonstrate themselves in-context." Frame-composition materials (giant CTA, glass) are
   filtered out of the token-mirror Components row.

Verified across light-glass (HeyGen), light-mesh (Stripe), and no-gradient (Opus); all 11
verify-green, no regressions in cover/claim/stat/Components.

**Honest ground (opus-reviewer follow-up).** First cut fabricated a full-bleed accent→canvas aurora
for any brand — the reviewer flagged this as off-brand for Opus (a dark/flat, screenshot-forward
brand with no gradient). Fixed so the focal ground is never invented:

- real captured wash → use it (Stripe mesh);
- brand genuinely uses glass but no wash → a **restrained accent GLOW** (radial, canvas stays
  dominant) so the frost has color to read over without a fake hero (Opus = dark canvas + purple
  corner glow, matching its real hero; HeyGen = white + cyan glow);
- neither → a flat brand ground, card floats on its own shadow.
  The panel gets the canvas-tinted frost only on a colored ground; on a flat ground it keeps the card's
  own surface fill (a canvas-frost would vanish against canvas).

Minor backlog from reviews (low): the token-mirror Components row under-renders a ghost `button-3`
(bare text, no outline) and the `nav-bar` mirror (empty solid box); the giant CTA could read a touch
larger in the focal panel.

## Done (cycles 1–4)

Gradient/mesh backgrounds · accent proportion · gallery-ground inversion · italic-font poison ·
primary-CTA identity (prominence re-rank + nav-CTA capture + alpha-drop fix + synthesized accent-pill
floor) · card elevation · frosted-glass (backdrop-filter) capture + material + render. All 11
verify-green throughout.

## Backlog — remaining essence gaps (deeper, need care)

- **Serif display font orphaned (kuse; systemic for serif-hero + sans-body sites).** The serif
  (Instrument Serif) is loaded but no type role uses it — display/heading map to the sans body
  (poppins), losing the serif-hero signature. The DOM sample picked the sans (font-inheritance / a
  non-hero h1). Fix: if a captured brand font is a serif/display face used by _no_ role, assign it to
  the display/hero role. (Generator, needs care to avoid mis-assigning.)
- **Shader/WebGL hero motifs (livekit HIGH, elevenlabs/heygen auras).** `shaders.json` (8 GLSL shaders
  on livekit; orb/particle/wireframe) is captured but never surfaced. And a repeating-line
  `linear-gradient` (livekit's 70px grid over `#070707`) is mis-labeled a gradient wash. Options:
  surface a `motifs:` flag ("hero uses animated shader") + classify grid patterns distinctly; full
  rasterization is a separate large effort.
- **Persistent accent CTA / accent starvation (kuse, snowflake, livekit).** Brands anchor the page
  with a persistent accent pill (kuse orange "Try free", livekit cyan "Start building"). The synth
  floor gives an accent pill when capture fails, but when a WHITE bordered pill IS captured it's kept
  over the real accent/charcoal CTA. Prefer accent/high-contrast fills over canvas-colored pills even
  when the canvas pill has a border.
- **Canvas/WebGL aura capture (ElevenLabs/HeyGen).** Their signature hero _glow_ is a
  `<canvas>`/shader (mask-gradients in CSS are just masks; the color orbs are shader) — CSS
  gradient/backdrop capture can't reach it. So the frosted-glass panel has no aurora to frost over.
  Separate effort (surface the shader or rasterize the glow layer during capture).
- **Snowflake blue-gradient CTA (higher-fidelity than the synth floor).** The real pill fill is a
  blue _gradient_ on an inner span/pseudo the button selector misses; we now synthesize a flat-accent
  pill (good floor). To get the exact gradient, broaden button capture to inspect a filled
  descendant / `::before`.
- **Stripe gradient as ambient field, not object.** Reviewer: the mesh should bathe the whole frame
  (feathered, full-bleed) rather than read as a contained radial blob on white. Renderer scale/blend
  tuning for the cover ground.
- **Live re-capture path.** The offline harness can't see purely JS-gated DOM (some CTAs, auroras).
  A thin live-capture mode (real `hyperframes capture`, network) would close the residual gaps for
  JS-heavy apps — but is fragile per-site (auth walls, anti-bot); keep offline as the default.
- **Robustness:** `isStaged` clean-name regex can false-exclude a legit source weight named like
  `Family-Bold.woff2`; consider staging into a separate `staged/` dir instead of writing back into
  `assets/fonts`.
