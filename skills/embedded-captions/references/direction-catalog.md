# Direction catalog

10 distinct aesthetic directions the skill can express. Each is a complete look: font, motion, color, placement, rhetorical defaults. The agent picks by **content tone × shot type × platform**, not preset name.

Current shipped templates (`modes/cinematic/*`) cover about 30% of this catalog. The rest are future ship-ready aesthetics.

Classification matrix — pick direction by intersection:

| Tone ↓ / Platform → | 9:16 portrait                            | 16:9 landscape           | 1:1 square               |
| ------------------- | ---------------------------------------- | ------------------------ | ------------------------ |
| **Documentary**     | documentary-dignified (vertical variant) | documentary-dignified    | broadcast-dignified      |
| **Conversational**  | portrait-header + default                | memory-wall OR champion  | broadcast-dignified      |
| **Energetic**       | high-energy-vlog                         | high-energy-vlog-wide    | high-energy-vlog-sq      |
| **Poetic**          | lyrical-poem-on-wall (portrait)          | lyrical-poem-on-wall     | chapter-card             |
| **Keynote/tech**    | — (9:16 not ideal)                       | tech-keynote-confident   | tech-keynote-confident   |
| **Investigative**   | —                                        | investigative-typewriter | investigative-typewriter |
| **Music video**     | k-pop-lyric                              | k-pop-lyric              | k-pop-lyric              |

---

## Direction specs

### 1. documentary-dignified _(Errol Morris / PBS Frontline)_ — Standard-mode direction (no prebuilt Cinematic template)

- **Family**: Söhne Mono OR GT Sectra for name cards; Inter for body
- **Weights**: 500 body, 700 name card
- **Color**: bone `#F5EFE6` on charcoal, OR charcoal `#1A1A1A` on bone. No accent.
- **Motion**: burn-in (no animation). Held 0.5s past last word.
- **Placement**: bottom-left block, 10% margin, locked position for whole interview.
- **Rules**: 2-line max. Speaker name card once at first utterance + after each cut. No emphasis styling — gravitas IS the style.
- **Rhetorical**: aggressive filler suppression. Every word is chosen.

### 2. cinematic-noir _(Kyle Cooper / Se7en)_

- **Family**: Distressed serif (Hoefler Text) + tight mono for detail
- **Weights**: 700 mostly; thin italic ONLY for whispers
- **Color**: off-white `#E8E0D0` with deep red `#8B0000` single-word accent for menace
- **Motion**: typewriter with 10% chance of 1px jitter on entry; scratched etch for chapter beats
- **Placement**: off-axis — avoid dead-center, slightly high-left or low-right
- **Rules**: no emoji, no rounded corners, everything hand-feeling

### 3. tech-keynote-confident _(Apple / Jony Ive ad)_

- **Family**: SF Pro Display OR Inter, nothing else
- **Weights**: 800 headline keyword, 400 context
- **Color**: pure white on any bg; `mix-blend-mode: difference` fallback for bright scenes
- **Motion**: swipe-reveal from bottom via clip-path (400ms); exit fades 400ms
- **Placement**: dead center, large. NOT lower-third.
- **Rules**: one caption on screen at a time. 2–5 words per caption. Long held silences between. Feels like slides.

### 4. lyrical-poem-on-wall _(extends current memory-wall template)_

- **Family**: Serif with personality — EB Garamond / GT Sectra / Caslon Italic
- **Weights**: 400–500 only. **This direction rejects bold.**
- **Color**: picks up wall via `mix-blend-mode: overlay`, opacity 0.85, no stroke
- **Motion**: etch in 600ms, hold 1.5–3s, etch out
- **Placement**: always on a surface in the scene (back wall, foam, whiteboard). Uses matte pipeline.
- **Rules**: captions are **fewer** than spoken text — 40–60%. Intentional silences. No other tool does this; strong differentiation.

### 5. high-energy-vlog _(controlled Hormozi)_

- **Family**: Inter ExtraBold, uppercase
- **Weights**: 900 always
- **Color**: white body + ONE accent (`#FFD600` or `#00E676`) + narrow 2px dark stroke
- **Motion**: word-pop with elastic, 60ms stagger; active word scales 1.15× on speech onset
- **Placement**: center-frame, ~35% from top
- **Rules**: max 3 words per frame. Hard break at breath pauses. Accent color on ~15% of words. **One full silence every 10s** (what Hormozi imitators miss).

### 6. chapter-card _(Wes Anderson / Grand Budapest)_

- **Family**: Futura Bold (modern) / Archer (warm) / Bodoni (formal)
- **Weights**: 700 chapter title, 400 attribution
- **Color**: pastel hue sampled from scene
- **Motion**: full-frame static card between interview segments
- **Placement**: centered card for chapters; lower-left name card during speech
- **Rules**: chapter cards get their own beat (0.8s silence before, 0.4s after). Feels authored.

### 7. investigative-typewriter _(Frontline / 60 Minutes / Morris Interrotron)_

- **Family**: IBM Plex Mono OR JetBrains Mono
- **Weights**: 500
- **Color**: white with 3px shadow, no stroke
- **Motion**: typewriter char-by-char 25ms/char; cursor blink 600ms after last char
- **Placement**: bottom band with 40% opacity gradient up — **NOT a hard box**
- **Rules**: one line only, two-line max. Every caption ends with 1-frame cursor-hold before next enters.

### 8. k-pop-lyric _(music video typographic flex)_

- **Family**: oversized display serif (Playfair Display / GT Super) + tiny mono detail line
- **Weights**: display 900, mono 400
- **Color**: deep saturated single hue per song/segment
- **Motion**: cascade entries alternating sides; words cross subject with mix-blend
- **Placement**: intentionally LARGE — sometimes bigger than the face
- **Rules**: emotional/musical moments only. Never informational content. **Breaks rule #1 (subject wins) on purpose** — that's the whole point.

### 9. broadcast-dignified _(BBC / NYT documentary standard)_

- **Family**: Helvetica Now / Neue Haas Grotesk
- **Weights**: 500 body, 700 name
- **Color**: white on 40% black gradient pill (not hard box, not plain shadow — gradient is the signature)
- **Motion**: 200ms fade-up, 150ms fade-down
- **Placement**: bottom-center, 10% margin, title-safe locked
- **Rules**: strict BBC — 160–180wpm, 32–34 chars/line, 2 lines max, 1.5s min gap. "Export to broadcast" mode. Boring on purpose. Never wrong.

### 10. conference-lower-third-killer _(B2B but not lame)_

- **Family**: GT America / Aktiv Grotesk
- **Weights**: dual-weight name card — role 400, name 700, same size
- **Color**: scene-sampled accent on name, white on role
- **Motion**: name card swipes in from left 400ms on first appearance only; subsequent static
- **Placement**: lower-left card + active-word highlight inline in dialogue above
- **Rules**: mode for podcast clips, founder interviews, keynote pulls. Sophisticated without being arty.

---

## Which to ship next

Current templates: `memory-wall` (roughly direction #4), `champion` (roughly a mix of #5 and #9), `portrait-header` (default vertical).

Priority ship order based on competitive gap:

1. **documentary-dignified** — no one else does this well; Errol Morris aesthetic is an unserved niche
2. **lyrical-poem-on-wall** (as distinct template) — the one that most uses our matte-embed moat
3. **high-energy-vlog** — matches but out-designs Hormozi/Submagic presets
4. **tech-keynote-confident** — big for product launch videos
5. **investigative-typewriter** — niche but highly distinctive

---

## How the agent picks

1. Classify the clip: `tone × shot × platform` (see matrix above)
2. Look up direction in matrix
3. Read that direction's spec in this file
4. Translate spec into plan.json parameters OR clone the canonical HTML from `references/example-renders/`
5. Tune layout per scene (agent judgment, see `aesthetic-principles.md §1–18`)

If no direction fits cleanly → **Standard mode**. Don't fake-fit an ill-matched direction.
