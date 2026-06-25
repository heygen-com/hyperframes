# Template catalog — the selection menu (Step 3)

Reverse-engineered, asset-free **group templates**. This file is the **only** thing the
planner reads to pick one — you do **not** open the template's `index.html` to choose. One
template realizes **one group** of a frame (a frame may stack several groups; the brand spine
unifies them).

**How to pick.** For each group, read its frame's `pacing` + `mood` + the one-line music
situation from the skeleton, then scan **Reach for it when** + **Best span** below and take the
closest fit. If nothing fits, **free-compose** from
[`motion-primitive-catalog.md`](motion-primitive-catalog.md) — that is a first-class choice, not a
failure.

**Brand comes from `frame.md`, not the template.** Templates ship their own demo palette
(`theme` / `palette` / color params). Fill those params from the project's `frame.md` (the
chosen preset's colors + fonts) so every group reads as one piece — the template supplies the
**motion + layout**, the preset supplies the **look**.

**Params** are listed so you can fill content slots in the storyboard. Exact semantics +
defaults live in each template's `index.html` (`data-composition-variables`) — the frame-worker
reads those at build time; you only name the values.

Pacing tag: every template below is **beat_cut** except `held-message-living-field`
(**phrase_flow**). Never put a beat_cut template on a phrase_flow frame.

## Group duration discipline

Template choice is per **group**, not per frame. A frame longer than a template's **Best span**
should usually split into multiple groups at real audiomap anchors (`SURGE`, `DROP`, roll edge,
hard_stop, phrase edge) instead of stretching one template across the whole frame.

- **Best span** below is the active treatment span: the part where the template's system is doing
  meaningful motion. A short readable hold at the end is fine; a long empty tail means pick another
  group.
- **Frames over ~6s** usually need 2+ groups. Beat-cut exceptions are rich programs with real
  sub-phases (`poster-tile-mosaic`, sometimes `card-flyby`); phrase-flow exceptions use
  `held-message-living-field`.
- **Roll templates are one-roll tools.** If a frame has two rolls or a drop between rolls, split it
  into two groups.
- Do not extend by slowing every tween. Preserve the template's motion feel, then fill extra time
  with a hold / palette change / new group.

---

### card-flyby

- **What** — a depth column of cards rolls forward through perspective; each landing beat tumbles the next card into the front slot with a solid colored wipe, the old front falls toward camera, dwells shrink card-to-card so the deck accelerates into a held final card.
- **Reach for it when** — a stream of discrete onsets that **accelerate** (gaps shrinking / a build into a downbeat) and you want to flash a **sequence of items** — titles, projects, posters, tiles — one per hit, climaxing on a held card.
- **Best span** — **4-6.5s** for 4-7 landings plus a short final hold; split at the next downbeat if it wants to run **>7s**.
- **Params** — `theme`, `bgColor`, `cards`, `landings`, `yaw`

### held-message-living-field · phrase_flow

- **What** — a readable mark (logo / word / title) held dead still over a soft, color-shifting blurred field; only the field breathes.
- **Reach for it when** — a **calm / sparse** stretch with an onset desert — energy present but few or no onsets (a held pad or riser); you have one word or mark to hold and let breathe.
- **Best span** — **6-16s**; this is the long-group exception. Under 4s feels underdeveloped; over ~20s needs a state change or another group.
- **Params** — `markText`, `titleText`, `tagText`, `palette`, `flowSpeed`, `duration`

### held-text-strobe-burst

- **What** — a dead-still word whose letters flip through texture-filled frames (texture-clipped fill + per-frame tint + bg color) every ~3 frames, in short bursts pinned to a roll.
- **Reach for it when** — a **dense, hard-hitting roll / fill** and a single word you want to strobe through textures for a few bars. (Ships texture-mask PNGs under `assets/`.)
- **Best span** — **1.2-3.5s**; strobe fatigue starts fast, so cap at ~4s and cut to a cleaner system.
- **Params** — `markText`, `fontStyle`, `markScale`, `idleColor`, `idleInk`, `frames`, `strobePlan`, `decor`, `duration`

### intro-kinetic-cascade

- **What** — a line laid out as a sequence of big editorial **phrases** (each a stacked poster with one enlarged hero word), revealed word-by-word on its anchors, hard cut between phrases, climaxing on a phrase that slides in with a swappable ringing **icon** (bell / cursor / sparkle / emoji / SVG).
- **Reach for it when** — an **intro / opening statement**: a short line to land word-by-word as big type, climaxing on one keyword + an icon. Medium-or-more energy, steady grid.
- **Best span** — **3.5-7s** for 2-4 phrase beats; if the statement needs more time, make the next clause a new group.
- **Params** — `theme`, `icon`, `phrases`, `climax`

### logo-split-lockup-pulse

- **What** — a two-part mark joined at center splits left↔right to open a gap, grows a center word-lockup one word per onset (key word lands on the downbeat surge), snap-closes on a hit, then pulses with the beat.
- **Reach for it when** — a short **logo / brand sting** (not a typed sentence): fast dense onsets + a sustained roll bed to pulse on, with a left/right bracketing mark.
- **Best span** — **2-4s**; at **>4.5s** it reads like a sting stretched too long. Follow with a separate held-lockup / next idea group.
- **Params** — `bgColor`, `markColor`, `textColor`, `leftMark`, `rightMark`, `word1`, `word2`, `word3`, `word4`

### poster-tile-mosaic

- **What** — a packed **mosaic** of different-sized colored tiles that tessellate to fill the frame (no overlap), driven by interchangeable beat-synced operations: staggered enter/exit, locked global recolor, snake-fill + overlay.
- **Reach for it when** — many discrete, individually-placeable onsets (a hit for every tile move) with distinct sub-phases you want articulated differently (accumulate → recolor-on-roll → fill-then-drop). A dense section best held as **one** rich tile program rather than split.
- **Best span** — **4-7s**, up to **8s** only when the program has clear sub-phases. If the music changes regime, split even if the tile system could continue.
- **Params** — `bgColor`, `tiles`, `bands`, `gap`, `showText`, `labels`, `program`

### roll-flipbook-word-cycle

- **What** — a hi-hat roll drives a centred word that flips every 16th-note through a word list; optionally the flicker resolves and locks into a final phrase.
- **Reach for it when** — a **fast sustained-fill roll** (hundreds of hits/min, ~16th-note) with no single readable message — fill the roll with a rapidly-cycling word flipbook.
- **Best span** — **1.2-3.8s**, one roll into one resolve. Two rolls, or a drop between rolls, means two groups.
- **Params** — `bgColor`, `textColor`, `accentColor`, `flipWords`, `resolveText`, `periodChar`

### split-anchor-word-slot

- **What** — a held left anchor column of fixed-word rows beside a torn-paper word-slot box on the right, driven by beat-synced operators: anchor lock-in, slot word-group cycle (in/out + per-line color), full-scene background flip, per-beat jitter, box-zoom exit wipe. Row count + number of flips are data.
- **Reach for it when** — a short section with a **held idea** (a brand / name to anchor on the left) **and** a stream of onsets popping separate words on the right, plus a dense run to ride a shake on and a strong downbeat to wipe out into.
- **Best span** — **3-6s**; above ~6.5s the fixed anchor goes stale unless the right slot enters a new group/program.
- **Params** — `bgColor`, `anchors`, `theme`, `showText`, `program`

### typewriter-phrase-keyword-shuffle

- **What** — words type in one-per-onset to spell a phrase, then one keyword cycles typefaces on the beat while everything else holds dead still.
- **Reach for it when** — a steady grid with a **continuous onset stream** (no desert): a phrase to type out, then a keyword to shuffle. The inverse of `held-message-living-field` (which wants an onset desert).
- **Best span** — **2.5-5s**; if the phrase cannot type and shuffle inside ~5s, reduce words or split the sentence across groups.
- **Params** — `bgColor`, `textColor`, `accentColor`, `lead1`, `lead2`, `lead3`, `keyword`, `periodChar`
