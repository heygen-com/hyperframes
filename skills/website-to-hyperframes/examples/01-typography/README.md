# Section 01 — Typography

12 scenes covering the most-used text animation effects from `skills/hyperframes/references/text-effects.md` plus 4 custom techniques (variable-font weight shift, glitch RGB split, scramble decrypt, intro kinetic stack) that aren't in the catalog but are heavily-used in modern marketing video.

**When to study this section:** any beat where text is the hero — headlines, statements, eyebrows, call-to-action copy, kinetic typography sequences.

---

## Scenes

Each scene is its own subdirectory containing `index.html` — standalone, renderable on its own via `npx tsx packages/cli/src/cli.ts snapshot scene-NN-name --frames 5`.

| Scene | Duration | Technique | Catalog spec |
|-------|----------|-----------|--------------|
| [`scene-01-soft-blur-in/`](scene-01-soft-blur-in/) | 8s | Per-character fade with blur and upward drift — Apple keynote hero | `skills/hyperframes/assets/text-effects/effects/soft-blur-in.json` |
| [`scene-02-typewriter-mechanical/`](scene-02-typewriter-mechanical/) | 6s | Stepped per-character reveal, no easing curve — terminal/editorial feel | `skills/hyperframes/assets/text-effects/effects/typewriter.json` |
| [`scene-03-kinetic-center-build/`](scene-03-kinetic-center-build/) | 8s | Each word locks center as phrase builds right-to-left with soft blur | `skills/hyperframes/assets/text-effects/effects/kinetic-center-build.json` |
| [`scene-04-line-reveal-staggered/`](scene-04-line-reveal-staggered/) | 7s | Lines clip-reveal upward with stagger — masked, contained, intentional | `skills/hyperframes/assets/text-effects/effects/mask-reveal-up.json` |
| [`scene-05-stagger-wave/`](scene-05-stagger-wave/) | 6s | Per-character rise with a wave timing curve (center-out, then edges-in) | `skills/hyperframes/assets/text-effects/effects/per-character-rise.json` + custom stagger |
| [`scene-06-variable-font-weight-shift/`](scene-06-variable-font-weight-shift/) | 7s | Headline animates `font-variation-settings` from `wght 100` to `wght 900` — kinetic without translation | Custom (uses Inter variable) |
| [`scene-07-shared-axis-crossfade/`](scene-07-shared-axis-crossfade/) | 9s | Two phrases swap via scale-Z depth crossfade — premium UI feel | `skills/hyperframes/assets/text-effects/effects/shared-axis-z.json` |
| [`scene-08-glitch-rgb-split/`](scene-08-glitch-rgb-split/) | 5s | RGB-channel split with mechanical jitter — digital/cyberpunk emphasis | Custom (CSS text-shadow + offset GSAP jitter) |
| [`scene-09-scramble-decrypt/`](scene-09-scramble-decrypt/) | 6s | Character scramble decrypts into final phrase — "intel/hacker" feel | Custom (per-character substitute) |
| [`scene-10-per-word-emphasis/`](scene-10-per-word-emphasis/) | 8s | Per-word crossfade with a hand-drawn circle marker landing on the key word | `per-word-crossfade.json` + section 02 marker |
| [`scene-11-orbital-title/`](scene-11-orbital-title/) | 4s | "KINETIC TYPE" Fraunces serif title with per-character alternating-side entrance + SVG accent-line stroke draw + rotating orbital ring with dot + radial glow breathing + 4-segment type-on tagline | Lifted from `claude-design-hyperframes-video/compositions/letters.html` and rebranded (HYPER FRAMES → KINETIC TYPE; HTML in. Video out. → Code in. Motion out.). Combines 5 techniques in one scene. |
| [`scene-12-intro-kinetic-text/`](scene-12-intro-kinetic-text/) | 5s | Large-scale word stacks with gradient sweep fills — bold kinetic opener for product launches or chapter cards. | Custom — use as the "loud" alternative to scene-01 when the brand wants confidence over restraint. |

---

## What to study, in priority order

1. **`scene-01-soft-blur-in.html`** — the canonical premium headline. Study how character splitting works, how the JSON spec maps to GSAP, how the y-travel-multiplier scales motion to 1080p.
2. **`scene-02-typewriter-mechanical.html`** — the simplest type-on. Study `steps(1)` ease and why it gives a terminal feel.
3. **`scene-10-per-word-emphasis.html`** — combination scene. Study how text effect + marker overlay are sequenced with `tl.add()` and overlap timing.

After these three, the others are variations on the same shape.

---

## QC log

Updated after building each scene. Format: `[PASS]` or `[REBUILD: reason]` or `[FIXED: reason]`.

- scene-01: **PASS** — 8 frames show 3 phrases cycling (Think different. → Built to flow. → Motion with intent.) with soft-blur per-character entrance, underline draw, grain drift, scale pulse during holds. Frame 1 correctly dark; mid-exit frames show in-progress blur correctly.
- scene-02: **PASS** — 6 frames show empty terminal → "Precision in motion." typed in → hold → exit → "Pause. Continue." typed in → final hold. Steps(1) easing visible per-char. Cursor blinks. Scanlines drift. Cursor glow pulses during holds. Phrase 2 shortened from "Write. Pause. Continue." to "Pause. Continue." to avoid text wrap.
- scene-03: **PASS** — 8 frames show kinetic-center-build: words push in from right, locking at center as phrase builds. Two phrases cycle ("Built to flow." then "Motion with intent."). Mid-build frames clearly show the layout-aware push behavior. 6 distinct easings, breathing during holds.
- scene-04: **PASS** — 7 frames show editorial mask-reveal-up: lines clip-reveal upward staggered. Beautiful Fraunces italic accent on "everything." word, gold accent rule + page number, vignette drift continuously. 7 distinct easings including the spec's signature curve. Fix during build: moved breathing tween off the same element as entrance tween to avoid transform conflict.
- scene-05: **PASS** — 6 frames show stagger-wave (center-out vs edges-in) side-by-side. Mid-entrance frames at 1.2s ("e from cent" center visible) and 3.6s ("Wave" + "dges." edges visible, middle hidden) prove the wave origin behavior. Yellow accent band + origin markers ground the typography. 9 distinct easings.
- scene-06: **PASS** — 7 frames show variable-font weight ramp wht 100→900. Frame at 1.2s shows the money moment: "WE" already bold, "IGHT." still thin — staggered weight shift left-to-right. Fix during build: replaced JS proxy object + onUpdate (broke under seek) with native GSAP CSS variable tween + @property registration.
- scene-07: **PASS** — 9 frames show shared-axis-z depth crossfade across 3 phrases. Mid-swap frames at 2.3s and 4.5s clearly show outgoing phrase scaling toward camera with motion blur while incoming phrase emerges from depth. Material Design Z-axis transition unmistakable.
- scene-08: **PASS** — 5 frames; 3 catch RGB-split glitch peaks (red/cyan channel offsets), 2 show clean settled state. Burst timestamps deliberately aligned with snapshot timestamps so peaks are caught. CRT scanlines, HUD corner brackets, status meta line. Cyberpunk vibe nailed.
- scene-09: **PASS** — 6 frames show scramble decrypt: initial scramble glyphs → left-to-right lock to "AUTHENTICATED" → hold bright → re-encrypt (rightmost chars last to unlock with different intermediate chars proving deterministic-but-distinct generation) → re-decrypt. Cursor blink, scanline, status dot all running continuously.
- scene-10: **PASS** — 8 frames; warm off-white paper background. Per-word crossfade entrance, hand-drawn orange ellipse marker draws around "intention" with stroke-dasharray, then secondary mark + handwritten "on purpose" arrow in Caveat font. Two transform-conflict bugs found and fixed during build (initial stroke visibility, linecap artifact at zero-dash).
- scene-11: **PASS** — 7 frames; orbital dot appears → KINETIC arrives from alternating sides while TY still mid-flight → full title landed → SVG accent line draws → orbital ring rotates → 4-segment tagline "Code in. Motion out." types in. 5 techniques combined. Lifted from claude-design `letters.html`, rebranded, Source Serif → Fraunces. Fix during conversion: source's onUpdate-driven tagline didn't seek; refactored to pre-rendered char spans with autoAlpha stagger.
