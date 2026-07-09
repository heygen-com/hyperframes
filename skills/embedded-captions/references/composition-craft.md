# Composition craft - EMBED track only

This is the deep "how to lay a caption INTO the scene" manual - it governs the **embed**
track only (captions composited behind the subject). The default **rail** track (standard
lower-third subtitle, where most text lives) has its own, much simpler spec → [rail.md](rail.md).
Read this before authoring any **promoted** phrase, in either authoring mode (template
Cinematic `plan.json` or Standard `index.html`).

Topics: phrase grouping, planes & clean-zone anchoring, zone coherence, climax pop,
readability, edge breathing, the occlusion 3-step judgement, accumulation, and persistence.

> **Two-track model (SKILL.md § Caption model).** Render states are `drop` / `rail` / `embed`.
> The `bg / fg / hybrid` axis used throughout the text below is **superseded**: read **"bg" as
> embed** (behind subject / in-scene), **"fg" as rail or promote-out** (in front), and "hybrid"
> as simply rail + embed coexisting. Everything here applies to the **embed** track - don't
> apply this craft to the rail.

(Granular sub-topics also have their own files - see SKILL.md § Shared knowledge.)

---

### Caption layer: BG vs FG (aesthetic axis)

Separately from template choice, decide whether captions are **embedded** (behind subject, matte occludes - default "embed" cinematic feel) or **announced** (in front of subject, no occlusion - poster / lower-third feel):

- **bg** - classic embed. Captions sit behind the matte, subject's body partially occludes letters. **Default for any cap that fits the frame.** Partial occlusion is the cinematic feature - small narrator caps with face nibbling 20-30% of letters reads as embedded texture; climax words with face crossing 30-40% reads as Vogue masthead. The eating is what sells the embed. Don't shrink to avoid it.
- **fg** - captions float on top, subject can't occlude. **Fallback for when bg cannot work.** Two scenarios:
  - **Climax fg**: the climax word is so big at impactful size that subject + frame width together leave no place for bg to render at all (subject fills frame AND climax phrase is long; bg would be eaten past readability into broken).
  - **All-fg fallback**: rare, only when the entire scene has no usable bg zone for any caption.
- **hybrid** (per-group `layer:` field) - when one cap (usually the climax) hits the "no place to fit bg" wall but the others (smaller body caps) still work fine in bg. **Body bg + climax fg** is the canonical hybrid pattern.

**Rule of thumb:**

- Small narrator/emphasis captions: bg almost always. Subject eating a few letter-edges = embed feature.
- Climax: try bg first, sized to maximally cross subject. If that size won't fit frame width, AND no clean zone elsewhere, use fg.
- Don't invert the hybrid: body fg + climax bg is the WRONG direction (sacrifices the easy bg embed wins on body, while the climax that needed protection from over-occlusion gets sent into the fire).

**Hybrid worked example - Startup_Host (subject fills frame).**

Subject fills the frame top-to-bottom (head_top y=126 / 10% from top). For body captions there's no large clean zone, but small italic narrator caps in upper corners get eaten ~25% by subject - that's the embed showcase. For the climax "SUCCESSFUL STARTUP" at maximally cinematic size, bg would be eaten 40-50%+ → past cinematic into broken. Climax goes fg.

```json
{
  "caption_layer": "bg",
  "groups": [
    {
      "id": "cg-0",
      "plane": "body",
      "layer": "bg",
      "css": "font-size: calc(0.055 * var(--h)); font-style: italic; ..."
    }, // narrator bg - face eats edges, embed texture
    {
      "id": "cg-1",
      "plane": "body",
      "layer": "bg",
      "css": "font-size: calc(0.085 * var(--h)); font-weight: 800; text-transform: uppercase; ..."
    }, // emphasis bg - Vogue masthead
    {
      "id": "cg-5",
      "plane": "crown",
      "layer": "fg",
      "css": "font-size: calc(0.09 * var(--h)); font-weight: 900; text-transform: uppercase; ..."
    }
    // ↑ climax fg: subject too dense for bg to land readably; fg fallback. Sized to fit frame width fully (single line).
  ]
}
```

Result: body bg captures embed cinematic across the subject (eaten edges = texture not bug), climax fg sits on top fully visible because there was nowhere else for it to go. make-composition.cjs emits both `index.html` (bg groups) and `index_fg.html` (fg groups); render-and-composite.sh runs two parallel Chromium passes and ffmpeg screen-blends fg over bg+matte.

Set via `caption_layer: "bg" | "fg"` plan-level (default for groups without explicit `layer:`), and `layer: "bg" | "fg"` per-group to override for hybrid.

**Decision rule - bg is default, fg is fallback, hybrid is for mixed semantic content.**

For BODY captions (narrator + emphasis):

1. **Find the actual clean zone.** Sample frames at 20/50/80% and mentally trace where the subject is (head, shoulders, gesturing hands). The clean zone is what's left. Top band above the head, bottom band below the shoulders, or off-center side column.
2. **Anchor the plane in that zone.** Body caps fit comfortably with NO subject overlap → `layer: "bg"`.
3. **If body cap stack inherently overlaps subject heavily (>40% per check-occlusion peak)** even at smallest reasonable fonts → body `layer: "fg"`. Subject fills frame too much for embed.

For CLIMAX caption (the payoff):

1. **Default: `layer: "bg"`, sized to maximally cross subject for embed effect.** The face/body eating part of the climax word IS the visual win. Don't shrink to avoid occlusion. Use the largest size that fits frame WIDTH (sub-pixel readable letters fully on-screen) - vertical position should land it across the subject's hair / forehead / face.
2. **`layer: "fg"` for climax** ONLY when frame width physically can't hold a font big enough to feel climactic AND there's no compositional way to break the word across multiple lines that bg embed could carry.
3. **Hybrid (body bg + climax fg)** is the canonical pattern for subject-fills-frame scenes. Body small caps stay bg - subject eats letter edges = embed texture (cinematic, not a bug). Climax goes fg ONLY because at impactful size + subject filling frame there's no place where bg climax could land readably (would be 50%+ eaten = past cinematic into broken). The opposite direction (body fg + climax bg) sacrifices the easy bg embed wins on small caps and forces the climax into a slot it can't survive - never do that.

**Editorial split - the spatial form of body bg + climax fg.** When the hybrid above is laid out with **bg in the upper half and fg in the lower-third**, you get a magazine-cover composition for free - no separate template needed. The rule:

- **Body caps (BG)** - placed in the upper half (top: 6-30%), at the head/hair zone. They get partially occluded by hair/forehead = vogue-masthead embed texture.
- **Climax cap (FG)** - placed in lower-third (top: 70-85%), in front of subject's chest/below. It's fully clear, fully readable, dominates the bottom band.

The viewer's eye reads top-to-bottom: first the partially-veiled body line ("decorative, atmospheric"), then the clean climax statement ("the point"). Same Z-axis layering as Vogue / Apple Keynote (decorative top behind subject + clear bottom in front), but driven by cinematic-cream's existing per-cap `layer:` field - no new template, no separate masthead track.

Two timing modes inside this layout:

- **Sequential cross-fade (default)** - body fades out as climax fades in over 0.3-0.5s. The brief overlap window IS the editorial dual-layer moment. Standard cinematic-cream behavior.
- **Sustained overlap** - extend body's `out` to coincide with or extend past climax's `in` so both are visible together for 1-2s. Use sparingly: works when body line is short (≤3 words) and acts as a "kicker" above the climax. Long body phrases sustained alongside a fg climax = visual noise.

**The plane-conflict rule for sustained overlap (debugged in Startup_Host).** If you extend a body bg cap's `out` into a window that contains another cap with `layer: "fg"` IN THE SAME PLANE, the two will visually overlap in the final composite - bg pass renders the extended bg cap, fg pass renders the fg cap, both at identical plane position, screen-blended on top of each other. Result: muddy double-text at the same spot.

Before extending any body bg's `out`:

1. Check what other caps occupy the body plane during the extended window
2. If ANY of them is `layer: "fg"`, the extension causes plane overlap → don't do it
3. Workaround: either (a) skip sustained overlap and use sequential cross-fade only, or (b) author the body kicker on a DIFFERENT plane / absolute position so the two don't share a plane

Concrete example: Startup_Host has cg-3 "diving deep" (body bg, plane=body, 3.1–4.15s) and cg-4 "into what it really takes to build a" (body fg fallback, plane=body, 4.15–6.42s). Both occupy `plane=body`. Extending cg-3 to overlap with the climax cg-5 (6.42–8.06s) ALSO drags cg-3 across cg-4's window where cg-3 (bg) and cg-4 (fg) collide on the body plane. Sequential editorial-split (climax in lower-third, body bg already faded out) was the only safe option for this case. AI_Insights had no fg in body plane between kicker and climax, so sustained overlap worked there.

When NOT to use editorial split:

- Body and climax are both information-carrying full sentences → forces viewer to read both at once, fails. Editorial split needs the body line to be _atmospheric / setup_ (italic mood), climax to be _the payoff_ (bold uppercase).
- Subject takes the full vertical column (no top clean zone, no bottom clean zone) → there's no upper or lower band to anchor either layer. Fall back to all-fg with crown.
- Climax is a long phrase that wraps to 3+ lines in lower-third → eats too much vertical real estate, leaves no room for the body bg above. Either shrink climax or split into more groups.

This pattern was historically what we called "hybrid" but the spatial framing - upper bg behind / lower fg in front - is what makes it read as editorial design rather than just two unrelated caption tracks. Keep this in mind when authoring per-cap `layer:` for hybrid scenes.

Common mistakes (debugged in real cases):

- Defaulting to "right column" because memory-wall did it → narrow 400px column forces long phrases to wrap 4-5 lines, pushing the stack DOWN into the subject's body. Fix: use top-band full-width instead, wider wrap fits fewer lines.
- **Flipping climax to fg because "viewer needs to read it" → kills cinematic embed.** Climax is supposed to feel half-eaten by subject; that's the magazine masthead energy. Don't fix what isn't broken.
- All-fg whole plan when subject fills frame → safe but sterile. Hybrid (body bg + climax fg) is almost always better - small body caps eaten = embed texture, climax fully visible since it had no readable bg slot.
- Sizing caps before choosing the plane → typography is a function of plane geometry, not the other way round.
- **Putting LONG multi-line phrases on bg in subject-fills-frame scenes.** "Subject eats letter edges = embed texture" only holds for short caps (1-3 words / 1 line). A 6-8 word italic phrase wraps 3-4 lines, and when subject's head is high in frame, **whole lines** of the phrase land deep in the body/face zone - entire words obliterated, not edge-textured. That's not embed, it's broken. **For long body phrases on subject-dense scenes: switch THAT specific cap to `layer: "fg"` even if other body caps stay bg.** Hybrid lets you mix per-cap. Sample the matte at the cap's time window: if head_top y is climbing and the cap's stack height extends into y > head_top, that cap needs fg.
- **Subject doesn't move uniformly across the clip - sample matte per BLOCK time window, not just once per case.** Startup_Host's head_top swings y=224→96 across 8 seconds (128px / 10% of frame). A block plan that worked at t=2 (head low, plenty of space) breaks at t=5 (head high, no space left). Per-block matte sampling > one-shot per case.

### Step 0 for ANY plan - transcript role annotation (mandatory)

Before writing a single caption group, do a **pre-plan agentic pass** over the transcript. Read every word and grade it. This is judgment, not a lookup - context decides (e.g. "like" is content in "like this", filler in "like, um, yeah"). No hardcoded word lists; agent decides per token.

**The grade is the SELECTION INPUT - it picks the render state** (`drop` / `rail` / `embed`); it is not itself a typography class (see SKILL.md § Caption model):

| Grade        | What it is                                                                                                                                               | → render state                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **drop**     | Interjections/hesitation (um, uh, er, ah), self-corrections ("I think- I mean actually…" keep only final), pure stutters ("the the the") collapse to one | **drop** (not shown)                                                                              |
| **normal**   | Ordinary spoken content - connective glue + the content words that carry the idea                                                                        | **rail** (dense conversational glue may be trimmed for readability; content/structure words stay) |
| **emphasis** | The 1–2 punch words in a phrase                                                                                                                          | **rail** + `emphasis` highlight (inline - stays on the rail)                                      |
| **peak**     | The payoff of a beat/section - the line you'd say out loud paraphrasing it                                                                               | **promote to embed** (apply the craft below); the single biggest of the whole piece = `apex`      |

A **peak** is per-beat, **not** per-clip: a short clip usually has one (its climax); a long/multi-section explainer has ~one per section. **Embed is scarce + spaced** - ≤1 per sentence/beat, never two adjacent or co-visible, ≥ a beat apart, at most one `apex`. (The old "1 climax / 2–4 emphasis / 4–10 body / 6–12 narrator / 2–8 drop per 10–20s clip" was calibrated for short single-beat clips; it generalises to "one peak per beat, spaced - everything else rides the rail.")

**This step replaces any filler-word list.** If you find yourself reaching for a regex, you're doing it wrong - go back and judge per-token.

Then build the plan from the annotated words:

- drops → do not appear in any word entry
- narrator → either fold into adjacent body groups OR become tiny italic subordinate groups if rhythm demands
- body/emphasis/climax → shape the group structure, with typography matching role

### The compositional unit is a PHRASE, not a chunk (read this twice)

A **caption group** is a semantic phrase, typically 2-8 words bound by intonation and meaning. It is NOT a mechanical "2-4 word chunk". A group has ONE typography (one font-size, one weight, one case, one position) matching its role; the "every-word" feel comes from **per-word anime.js timeline events INSIDE the group**, not from splitting the phrase into many tiny groups.

Canonical reference - memory-wall, 12 spoken words, **4 groups**:

- cg-0 `"Some memories feel soft"` (4 words, italic 600, right-top)
- cg-1 `"like old film"` (3 words, italic 500, right-mid, smaller)
- cg-2 `"but suddenly"` (2 words, upright 700 pivot, right-center)
- cg-3 `"EVERYTHING IS SHARP AGAIN"` (4 words, uppercase 900 climax, spanning width)

Every word is shown. Groups **cascade and accumulate** - cg-0 stays on screen while cg-1 enters below; by the climax, all 4 are visible simultaneously as a poem. Per-word stagger (~80ms) animates each word into its group in sequence.

If you find yourself producing 15+ groups for a 10s clip, stop - you're treating verbatim as mechanical chunking. Go back, re-read the transcript, identify 4–7 phrases, and make them groups.

**Don't split idioms, collocations, or bound phrases across groups.** "Not even kidding", "at the end of the day", "as a matter of fact", "whole lot of", "more or less", "a little bit", "kind of", "sort of", proper nouns ("Blackmagic Pocket 4K"), brand phrases, and other fixed expressions are semantic units. The climax of "I'm not even kidding" is the whole idiom, not just "KIDDING". The climax of the memory-wall canonical is "EVERYTHING IS SHARP AGAIN" as one group, not just "AGAIN". Splitting these across group boundaries breaks meaning AND typography (you can't render "not even kidding" with "not even" italic-small and "kidding" uppercase-huge - it reads as two different statements).

### Captions are always verbatim

Every word the speaker says gets captioned. The skill no longer ships a "highlight" mode - curated/edited transcripts produced fewer beats but lost the rhythm of the spoken sentence and ended up feeling like generic subtitle tracks. Verbatim with strong typographic hierarchy (small italic narrator → emphasis upright → climax massive uppercase) gives the cinematic feel without dropping content.

The only words you remove from the transcript:

1. **Pure phonetic interjections** (um, uh, er, ah, hmm) - not words, not captioned.
2. **Exact immediate stutters** ("the the the" → keep one; "is is is is" → keep one, aligned with the phrase that follows). The viewer should see one "the", not three.
3. **Self-correction backtracks** ("I think- I mean actually…" → keep only "I mean actually").

**All content words AND structure words stay** (articles, conjunctions, prepositions, auxiliaries, pronouns). Dropping a structure word like "in some" or "and I've" or "out of it" is a bug, not a stylistic choice.

### Planes - shared parent containers for spatial coherence (RECOMMENDED)

The memory-wall and champion canonicals don't set `top:` on each caption. They have a **parent container** (`wall-plane` / `left-plane` / `crown-plane`) that owns the spatial anchor, and caps are children that stack automatically (flex column with gap) or replace (absolute at same anchor).

Your plan.json can opt into this by declaring `planes` and assigning each group to one:

```json
{
  "planes": {
    "body": {
      "css": "top: 4%; right: 4%; width: 720px; display: flex; flex-direction: column; align-items: flex-end; gap: 14px;"
    },
    "crown": {
      "css": "top: 32%; left: 0; right: 0; text-align: center;"
    }
  },
  "groups": [
    { "id": "cg-0", "plane": "body",  "css": "font-size: calc(0.08*var(--h)); font-weight: 600; font-style: italic;", ... },
    { "id": "cg-1", "plane": "body",  "css": "font-size: calc(0.10*var(--h)); font-weight: 800;", ... },
    { "id": "cg-2", "plane": "crown", "css": "font-size: calc(0.20*var(--h)); font-weight: 900; text-transform: uppercase;", ... }
  ]
}
```

The plane CSS owns positioning (top/left/right + display:flex/grid/block). Per-group CSS owns **typography only** (font-size, weight, style, case, letter-spacing, line-height). **No top/left/right/position on a group when it's inside a plane** - the parent decides.

**Typography is agent-authored per group, NOT looked up from a preset.** The `cinematic-cream` template locks only the DNA (Inter family, motion curves, `mix-blend-mode`, `cap_color` palette, text-shadow/filter derived from luminance). Everything else - `font-size`, `font-weight`, `font-style` (italic vs upright), `text-transform` (uppercase vs mixed), `letter-spacing`, `line-height` - is written by the agent, per group, in `plan.json`'s `css` field. No "cap-1 must be italic 600, cap-2 must be uppercase 900" rule. Read the scene + transcript, pick typography that matches the semantic role (narrator/body/emphasis/climax) and the visual weight the frame can carry. See [references/typographic-moves.md](typographic-moves.md) for _recommended_ combinations - treat as palette, not schema.

When to use planes:

- **Multi-phrase sentence in one home zone** - use a flex column plane. All body caps inside accumulate/stack automatically, no collision math. This is the memory-wall pattern.
- **Body zone + climax zone** - two planes: body (flex stack) + crown (center). Body caps live in body-plane; climax pops in crown-plane. Cross-plane transition = earned break.
- **Any clip with ≥3 body phrases** - single-plane flex stacking beats hand-placing each group's top% every time.

### Picking the plane anchor - find the ACTUAL clean zone in THIS scene

**Do not default to "right column" because memory-wall did.** Memory-wall worked because its subject sat left-center with a clean wall on the right. Different scenes have different clean zones:

- **Subject centered (most selfies, vlogs)** → top band above the head is usually cleanest (clear sky / ceiling / wall). Right or left columns get eaten by shoulders or hands.
- **Subject left (interview with right-column backdrop)** → right column cascade (memory-wall classic).
- **Subject right (reverse interview)** → left column cascade.
- **Two-shot or busy background** → may need to use a corner, or sit the caption on the ONE surface that's consistently clean (a solid jacket, a whiteboard, a ceiling).

Before writing plane CSS, look at a frame sample. Mentally trace the subject's bounding box and hand-gesture reach. The plane anchors into whatever's LEFT - negative space where the cascade won't be eaten by body or busy backdrop.

Small-size italic narrator text is especially vulnerable - it disappears into mottled backgrounds or body occlusion. Keep smallest caps in the cleanest part of the zone, not at the edges where subject extends.

When NOT to use planes (the remaining free-mode use cases):

- **1–2 isolated groups** with deliberately different positions - free mode is simpler.
- **Specific clip-spanning motion** where a group needs to drift/move independently.

Free mode (no `planes` declared) is still supported - each group's CSS owns its own top/left/right. Use when you genuinely need bespoke per-group placement.

Wrong: "primary slot for 9:16 is top:12%". That's a lookup; it produces generic output.
Right: look at THIS scene, find where captions will read cleanly, respect the speaker's framing, and pick a composition pattern that serves the content's narrative arc.

Example patterns an agent can pick (not exhaustive, not ranked):

- **Right cascade accumulating** (memory-wall): all groups right-aligned, stepping down in top%, they stay - final frame shows a poem. Works when subject is centered-left and there's clean right-column space.
- **Center stack climax** (Sunset): italic openers at top, upright pivot mid, uppercase climax takes the full top as the final beat, earlier groups fade out before climax. Works when subject is centered and scene has clean sky + clean below-shoulders.
- **Left-right split** (memory-wall variant): narrator voice on one side italic, statement voice on the other side upright, climax takes center. Works when subject has off-center clean zones.
- **Single-line subtitle rail**: legit choice when scene is dense and no clean zones exist (busy background, subject fills frame). This is the "accessibility" fallback, not the default.

Whichever pattern is picked, the agent's job is to **justify the choice**: "Subject is on the left, clean gradient sky on the right - I'll cascade right-aligned so captions have clean backdrop throughout." Write that reasoning as a `_notes` field in plan.json so the intent is inspectable.

Anti-patterns to NEVER ship:

- Alternating top↔bottom per chunk - reads as chaos (one sentence's words appearing in different vertical zones).
- Locking every group to the same `top` value - reads as subtitle track, kills cinematic feel.
- Placing body/narrator groups directly over the face when clean space exists - the Vogue-embed effect is for the CLIMAX word only, not default behavior.
- **Dropping transcript words to fit caps in fewer blocks.** NEVER. Verbatim is verbatim. If 4 caps don't fit in 1 block, split into 2 sub-blocks of 2 caps each - keep all words. The only legitimate drops are SKILL.md's filler list (um/uh/exact-stutters/self-corrections), not "we ran out of room."
- **Mechanically aligning all caps in a plane to share `out` time.** This makes everyone stay on screen longer, _increasing_ density. Wrong fix for the no-jump problem. Correct fix: split natural-handoff caps into separate blocks where each block's caps share `out` (same exit moment, no jump), and `next_block.in ≥ prev_block.out` (clean handoff between blocks, no overlap).

**Block boundary three laws** (must hold for every plane in every plan):

1. Within a block, all caps share `out` - they fade together, no per-cap exit jitter.
2. Between adjacent blocks in the same plane, `next_block.in == prev_block.out` (or `next.in > prev.out` with a small gap). Caps from prev_block must FULLY exit before next_block's caps mount; otherwise the prev cap's exit at its `out` time triggers a flex reflow that yanks next_block's already-mounted caps upward = jump.
3. `prev_block.out ≤ next_block.first_word.start` so next_block's first word still animates from its real spoken time (the in-time only constrains when the container mounts; word animations fire at their per-word `start`).

A common mistake: setting `next_block.in` slightly EARLIER than `prev_block.out` to give the new block a head-start fade-in, while prev_block still has a different (later) `out`. The 50-300ms overlap looks invisible in the plan but produces a visible jump on screen because two caps with different `out` coexist in the same flex stack.

- **Vertical gap between body bottom and crown top.** Looks disconnected ("The pace is" at top:3% with "UNPRECEDENTED" at top:20% creates 144px void). Bond the setup phrase + climax word in the SAME crown plane via flex-stack - the Street_Talk "and being / CONSISTENT" pattern.

### Zone coherence - one sentence, one home zone

**Never switch spatial zones mid-sentence.** A full semantic unit (sentence or clause) should live in ONE home zone (e.g. right column, or top band). The viewer's eye follows the phrase group. Ping-ponging between top/bottom/left/right for consecutive phrases of the SAME sentence reads as chaos - the reader has to re-find the caption every beat.

Zone changes are earned at:

- **Sentence boundaries** (period, long pause, topic shift) - allowed to move to a new home zone, often paired with a tonal shift (italic body → uppercase emphasis)
- **The single climax** - the one break from the home zone, always allowed, often takes center-full-width

Heuristic: if you find cg-N and cg-N+1 are in different zones (top vs bottom, left vs right) AND they're parts of the same sentence (no period/long pause between them), you've violated zone coherence. Fix by picking one home zone for the whole sentence.

### The climax has to POP - not just "be a bit bigger"

A climax caption that's the same size as body emphasis is a failed climax. The viewer's eye needs a clear visual break: THIS is the payoff.

**Size the embedded climax to the FRAME, not to the rail (two-track rule).** The climax is a hero - its size is anchored to frame height: **`font-size: calc(0.16–0.22 * var(--h))`** (default ~0.18–0.20h; go bigger for more impact - it should dominate the frame, only width/readability caps it). It is **NOT** a multiple of the rail: the rail is a small standard subtitle (~0.045h), so "≥1.8× the rail" would yield a tiny, weak climax. Express rail, embed-body and embed-climax all as `var(--h)` fractions so they scale across resolutions - **never hardcode px**. The ratios below are a **floor / hierarchy check** (the climax must clear body-emphasis by ≥1.8× and the smallest tier by ≥2.5×), not the climax's sizing basis. Width is the real ceiling: shrink only if the word can't fit the frame at a legible size (see "Readability is a hard constraint").

Contrast floor - the climax must at least clear these:

| Ratio                      | Feels like                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| **1.0-1.3× body emphasis** | Flat - the climax is just another beat. Fix it.                                             |
| **1.5-1.8× body emphasis** | Noticeable but not explosive. OK for subtle payoffs, weak for punchlines.                   |
| **≥1.8× body emphasis**    | Pops. Viewer's eye snaps to it. Target for "punchline" / "reveal" / "reaction" climaxes.    |
| **≥2.5× body italic**      | Compare against the SMALLEST body tier too - the multi-tier jump is what creates hierarchy. |

A quick audit script - before shipping, dump every plan's max-body vs max-crown font-size ratio, and flag anything <1.8×:

```js
const bodyMax = Math.max(...plan.groups.filter((g) => g.plane === "body").map(fsize));
const crownMax = Math.max(...plan.groups.filter((g) => g.plane === "crown").map(fsize));
const ratio = crownMax / bodyMax; // aim for ≥1.8
```

**Split pattern - when one word alone should carry the climax.** If the climax phrase is 2+ words ("and being consistent", "not even kidding") and one of them is the actual payoff, split into setup + payoff BUT keep them spatially bonded:

- Setup words → small italic narrator (soft, trailing off) on line 1
- Payoff word → massive uppercase on line 2, same plane, flex-stacked directly below
- **Both groups live in the SAME (crown) plane**, flex-column, gap 4-8px. Not two different planes - otherwise "and being" sits in the top band and "CONSISTENT" sits mid-frame and they read as two unrelated captions.

Crown plane CSS for split climax:

```
"crown": "top: 26%; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px;"
```

Street_Talk canonical example: original was `"AND BEING CONSISTENT"` all in crown at 0.085h (same as body emphasis, ratio 1.0×). Rewrite: crown plane becomes a flex-column; `"and being"` → 0.055h italic at top of column (line 1); `"CONSISTENT"` → 0.11h 900 uppercase stacked below (line 2). The payoff POPs because of size contrast within a bonded 2-line composition, AND it crosses the subject's head since the crown column is anchored at ~26-30% top.

Timing: both groups share `out` (at clip end or block boundary) so neither fades alone - they hold together as one composition. Setup enters first (soft fade-in), payoff enters later when the word is spoken (snappier present scale-in).

**Readability is a hard constraint - bleed can't eat the word.** Your first move when a climax word overflows is NOT "accept the bleed, it's cinematic" - it's "shrink to the largest size that fits." Compute the max font size that fits the frame:

```
max_font_px = frame_width / (chars × char_ratio × letter_spacing_mult)
```

For "CONSISTENT" (10 chars), uppercase 900 (char_ratio 0.62), letter-spacing -0.05em (mult 0.95), 720px frame: `max = 720/(10*0.62*0.95) = 122px ≈ 0.095h`. Use 0.09h for a small safety buffer. The word fully occupies the frame edge-to-edge - that's already maximum visual impact without losing any letter.

Cinematic bleed is only OK when **a few pixels of 1-2 outer letters** get mild cropping from scale-in animation or sub-pixel rounding - that reads as "bigger than frame." Any bleed that forces the reader to mentally complete missing letters (>15-20px per side on a 10-char word) is a BUG, not style. "ONSISTE" with 80px each side clipped is NOT a valid climax - it's broken.

Hard rules:

- **Readable first.** Every letter should be fully on-screen, with at most a few-px crop on the first/last letter.
- **If max legible size doesn't meet ratio target**, raise impact via _other_ signals (weight 900, all-caps, bg head-cross, multi-line composition with setup word above), not via illegible bleed.
- **Never bleed body/narrator captions.** Only the crown/climax is allowed any edge crop at all.
- `OCCLUSION_SKIP=1` is an escape hatch for iterating; the shipped plan should pass `check-occlusion-v2.py --strict` (pixel-perfect via headless Chromium DOM).

### Edge breathing + climax-crosses-head (bg showcase)

Two placement tweaks that separate "looks like a caption sitting in the scene" from "looks like a pasted subtitle":

- **Non-climax caps need edge breathing room.** Body-plane groups should NOT hug `left: 0; right: 0` flush to the frame. Add `left: 3-6%; right: 3-6%` (or `right: 30-40px` for pixel-anchored planes). The breathing sells the compositional choice - flush edges read as "default subtitle track", indented edges read as "considered composition". Top edge the same: `top: 2-6%` not `top: 0`.

- **The climax SHOULD cross part of the subject's head - deliberately.** This is what makes bg-layer captions feel cinematic instead of just "text floating above the speaker". The effect is strongest when 20-40px of the word's last line dips behind the hair or forehead - viewer reads the word clearly AND sees it being occluded at the edge. Not "covered by the face" (unreadable), just "grazed by the hair" (legible + cinematic).

  How to place the crown with intent:
  1. Sample the matte PNG at climax time: `f_{frame_idx:04d}.png` where `frame_idx = round(climax_time * fps)`.
  2. Scan rows from top until `alpha > 128` - that y is the subject's topmost pixel (usually hair).
  3. Position crown so the _bottom of the last line_ lands 30-80px below that y. For a 2-line crown at 0.085h on 1290h frame, line heights ~104px each; total height ~200px. If subject top is at y=445, set `crown.top` such that `top + height = 445 + 50 ≈ 495` → `top = 295px ≈ 23%`.
  4. Verify with checker - the HERO/crown peak occlusion target is ~30–55% (the embed effect; the head crossing the middle). Below ~15% it reads as a floating label (the hero-weak advisory fires); above ~65% the word is eaten (the gate FAILs). Small narrator caps: ~20–30% texture.

  Practical rule of thumb: **crown peak occlusion 3-10%** is the sweet spot. The checker's number tells you directly - not a subjective "it looks good" judgment.

  **Crown defaults are scene-specific, not template-wide.** Don't set `crown.top: 6%` because "that's what the previous case used." If the subject's head_top is at y=380 (29% of frame) and your crown is at top:6% with 100px height, the crown bottom lands at y=200 - 180px ABOVE the head, completely floating in sky, zero embed effect. Always sample the matte once per case and compute `crown.top` from `head_top - crown_height + (30 to 80)` so the crown's bottom edge dips into hair. This was a real bug across 6 cases until enforced.

  FG-layer crowns skip this entirely (they render on top, no occlusion to showcase) - FG is announcement, not embed.

### Pre-render occlusion + frame-overflow gate

**`check-occlusion.cjs` (canonical, pixel-perfect)** is the only occlusion checker in `scripts/`. It auto-runs `measure-layout.cjs` (headless Chromium via Puppeteer) which loads the compiled `index.html`, seeks the registered anime.js timeline to 4 sample times per group (15/40/65/90% through window), and queries `getBoundingClientRect()` on every `.cap` and child `.w` span. Output is `_layout.json` with the actual rendered pixel coordinates of every word at every sample. Then it computes per-word, per-cap occlusion against the real subject-matte alpha (read via `sharp`):

- **Per-word peak occlusion** - the load-bearing metric: a 5-word phrase where 3 words are fully eaten averages the same as 8 words half-eaten, but only one of those is shippable, so per-WORD peak is what gates. Per-word peak ≥65% = `obliterated`, ≥35% = `warn`. A `WARN` band hit on a single climax word is OK (cinematic edge crop); two adjacent words obliterated is not.
- **Per-cap aggregate** - avg + peak occlusion across all samples. Cap fails at peak ≥50%.
- **fg-layer caps are auto-skipped** (they render above the matte; no occlusion possible).

**Why measure the real DOM, not estimate a bbox.** An earlier heuristic estimated each word's box from `char_ratio × font × text_length` and was wrong in both directions. Startup_Host case: it reported `cg-1 "podcast." OK at 9%/12%` because it guessed y=134 (above the subject's head), but the rendered DOM was at y=209 (mid-head) → actually `FAIL 54%/60%`. Same case, it reported `cg-3 "diving deep" FAIL at 76%/77%` while the real measurement was `WARN 36%/40%` (the box is wider than the head - most pixels clear, only descenders dip into the silhouette). Estimation is retired; `check-occlusion.cjs` measures the rendered pixels.

**Frame-edge overflow** - the checker also flags when a measured word bbox extends past the canvas (text the ffmpeg crop would clip), reported as `cg-N  [overflow] "word" off-frame: left Xpx, right Ypx (@Ts)`. Because cropped body text is always wrong, a clear glyph clip (>8px past an edge) **fails `--strict`**; a sub-glyph graze (≤8px - the first/last-letter crop the climax is allowed) is a non-blocking `[overflow-warn]`.

**The checker reports facts, the agent applies judgment.** A FAIL is NOT an automatic "must re-layout" signal - it's evidence to interpret. Two competing goals coexist:

1. **Readability** - every sentence must remain comprehensible to the viewer
2. **Cinematic embed** - partial occlusion is the desired vogue-masthead effect; zero occlusion looks like a pasted subtitle

When the checker reports a per-word obliteration (≥65%), apply this **3-step decision rule** before changing anything:

**Step 1 - POS check.** Is the obliterated word a function word (the / a / an / of / in / on / at / to / I / it / is / are / was / be / that / this / which / and / or / but)? Function words are grammatically optional in most contexts - a 100%-eaten "the" or "I" or "of" usually does NOT break the sentence. Content words (nouns, verbs, adjectives, climax words) carry meaning - they MUST stay legible.

**Step 2 - sentence parse without the word.** Mentally delete the obliterated word from the sentence. Does the remainder still convey the meaning?

- "like this are why I travel" minus "I" → "like this are why travel" - first-person obvious from context, **OK**
- "take it all in" minus "all" → "take it in" - complete English idiom on its own, **OK**
- "a whole lot of information" minus "of" → "a whole lot information" - slightly broken but recoverable, **OK**
- "diving deep into startups" minus "deep" → "diving into startups" - works fine, **OK**
- "diving deep into startups" minus "diving" → "deep into startups" - loses the verb, sentence breaks, **NOT OK**

**Step 3 - cinematic check.** A single content word at 30-65% partial occlusion is the _intended_ embed look (vogue-masthead "subject grazes the text"). Don't "fix" it. Only escalate to re-layout when:

- a content word is ≥80% gone (not just partially eaten - almost fully missing)
- two or more adjacent words are ≥50% obliterated (sequential damage compounds; "X X X really takes" with first three eaten is unrecoverable)
- the obliterated word IS the climax / key noun the viewer is supposed to read (e.g. the subject of a sentence, a brand name, a product feature)
- key letters of a climax word are eaten (e.g. "STARTUP" with the S gone reads as "TARTUP" - the partial-letter pattern matters more than the whole-word percentage)

**Real examples from the 13-case batch** - all four caps below got a per-word obliteration FAIL, all four were correctly judged OK by this rule:

| case               | obliterated word @% | sentence                              | rule applied                           |
| ------------------ | ------------------- | ------------------------------------- | -------------------------------------- |
| Sunset_Stroll cg-1 | "I" 100%            | "like this are why I travel"          | function word + parses without it → OK |
| Sunset_Stroll cg-3 | "all" 75%           | "take it all in"                      | "take it in" is a complete idiom → OK  |
| yt_gtds cg-6       | "of" 69%            | "a whole lot of information"          | function word + recoverable → OK       |
| AI_Insights cg-2   | "that" 66%          | "that don't replace human creativity" | relative pronoun, optional → OK        |

**When the rule says re-layout** - what to change:

- per-word obliterated AND content word AND breaks readability → switch THAT specific cap to `layer: "fg"` (per-cap override, not whole-plan), OR shrink/reposition, OR split the cap into a different block where the subject isn't crossing it.
- per-cap fail (peak ≥50%) when the whole stack is in the head zone → lift y or shrink the block.
- frame-edge overflow → shrink font OR tighten `letter-spacing` OR split the phrase. Cropped text is ALWAYS wrong, no aesthetic excuse.

**Override** (for iterating before shipping): `OCCLUSION_SKIP=1 bash render-and-composite.sh <project>` - don't ship past this without applying the 3-step rule and either fixing or consciously accepting each FAIL.

### Accumulation capacity - split into blocks when the plane can't hold more

Each scene's clean zone has a finite capacity for simultaneously-readable caps. **The agent must judge this before writing the plan**, not rely on CSS `bounded height` / `overflow: hidden` - those cause visual bugs (caps overflow off-screen, are clipped, or content is centered outside the plane bounds).

Rule of thumb (capacity = max caps visible SIMULTANEOUSLY in one block):

- **9:16 portrait, narrow right-column plane** (width ~380-420px) → max **2 caps** per block. Long phrases wrap to 2-3 lines; a 3rd cap starts spilling into the subject.
- **16:9 landscape, subject centered** (e.g. selfie vlog) → max **2 caps** per block. Even if the frame is wider, a centered subject leaves narrow columns on both sides and hands reach far.
- **16:9 landscape, subject on one side** (e.g. interview with clean opposite side - the memory-wall canonical scenario) → max **3-4 caps** per block. This is where accumulation shines.
- **Top-band full-width plane** (either orientation) → max 1-2 caps before overflow into face zone.

Capacity is about the specific scene - same orientation can have very different room depending on subject position and background complexity.

When your phrase count exceeds the capacity, split into multiple accumulation blocks at **sentence or clause boundaries**. Example memory-wall canonical on a 12-word clip:

- Block 1 (0–4.85s): `"Some memories feel soft"` + `"like old film"` - 2 caps accumulate, fade together at 4.85s
- Block 2 (4.90–8.04s): `"but suddenly"` + `"EVERYTHING IS SHARP AGAIN"` - 2 caps accumulate on a cleared plane

All caps in one block share the same `out` time (sentence boundary). Next block's `in` > previous block's `out` so the plane clears before the new accumulation starts. This gives each cap ~3-5s of read time, avoids overcrowding, and matches memory-wall's cinematic rhythm.

**Why the shared `out` is load-bearing.** The template's exit path is `tl.add(sel, { opacity: 0, display: "none", duration: 0 }, ms(g.out))`, at `out`, each cap releases its flex space so the NEXT block's caps can take the top slot from the plane's origin (no permanent downward drift). If caps inside the same block had staggered `out` times, the plane would reflow mid-block (cap 1 vanishes, caps 2-3 jump up, cap 4 arrives, visible jitter). With block-synchronized `out`, the reflow happens ONCE at the boundary, invisible to the viewer because the block fades as a unit. **Never stagger `out` times within an accumulation block.** If you need individual fade-outs, you're not accumulating, switch to stagger-fade pattern (one group at a time, no flex plane needed).

**Anti-pattern: bounded `height` + `justify-content: center` on planes.** Do NOT write `height: 70%; justify-content: center` on a flex-column plane hoping to vertically center the caps. When the block's total cap height exceeds the bounded height, flex centering pushes content OUTSIDE the plane bounds on BOTH top and bottom - the topmost cap ends up above the frame (off-screen, unreadable). Instead:

- Let the plane grow with its content - set `top:` (origin anchor) and let caps stack down naturally.
- Use `gap:` between caps; don't try to "center the stack".
- Trust the block-capacity rule above to keep the stack within the clean zone - don't paper over overflow with `overflow: hidden` (it clips the very caps you wanted the viewer to read).

### Accumulation - vertical spacing, not single-line

Accumulation works with multi-line phrases too - memory-wall canonical's groups are multi-word, right-aligned cascade in 16:9 landscape, and several wrap to 2 lines. They don't collide because **each group's `top` is placed below the previous group's bottom extent with a margin**.

Math you must do before shipping accumulate:

For each group, estimate its rendered height:

- `line_count ≈ ceil(chars × font_px × 0.72 / usable_width_px)` (0.72 = Inter 900 uppercase; use 0.60 for italic/regular)
- `group_height_pct ≈ line_count × font_size_pct × line_height × 100`

Then for each pair (cg-N, cg-N+1) you want to coexist:

- `cg-(N+1).top ≥ cg-N.top + cg-N_height_pct + 2%` (margin)

If the math doesn't fit in the available clean zone (top-clear + bottom-clear zones minus face/body bbox), you have two options:

- **Shrink fonts or merge phrases** so they fit.
- **Switch persistence to stagger-fade** (groups don't coexist, no spacing constraint).

9:16 portrait specifically: clean zone is typically top 0–32% + bottom 72–90%, split by the subject. That's ~50% of frame height usable. At 15% per 2-line group + 2% margin, you can fit ~3 accumulating groups in top zone. A 4th must either (a) be smaller to fit, (b) go to the bottom zone (zone change allowed at sentence boundary), or (c) replace an earlier one as climax.

Landscape 16:9 has ~70–80% usable vertical - more room for 4–5 accumulating groups, which is why memory-wall canonical works cleanly there. Don't give up accumulation on portrait; just do the arithmetic first.

### Persistence - how long each group stays (agent decides per case)

The group's `out` time is not a default, not a rule, not a formula. It's an aesthetic choice. The same 5-group plan renders very differently depending on whether groups accumulate, stagger, crossfade, or roll - and each is right for different content.

Patterns to pick from:

| Pattern                                     | What happens                                                                 | Good for                                                                                            | Bad for                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Accumulate-through-climax** (memory-wall) | All groups stay on screen until climax arrives, then all fade together       | Poetic builds; emotional crescendo; ≤5 groups where each word matters                               | 8+ groups (screen crowds); punchy comedic beats (breaks the laugh) |
| **Stagger-fade** (Sunset-style)             | Each group fades ~0.8–1.5s after its words end; next enters into clean space | Independent punchy beats; clip where each phrase is its own moment                                  | Long poetic builds that want the stanzas to coexist                |
| **Crossfade-handoff**                       | Current group fades during next's entrance (~200ms overlap)                  | Dense verbatim (6+ groups in short clip); conversational flow                                       | Short sparse clips - feels like subtitle track                     |
| **Rolling window**                          | Keep N=2–3 visible; earliest fades when N+1 enters                           | Longer transcripts (15s+) where full accumulation would crowd, but some layering is still cinematic | Clips <8s (rolling isn't perceptible)                              |

Decision axes:

- **Narrative arc** - crescendo/revelation → accumulate; list of independent points → stagger; dense conversation → crossfade
- **Group count** - ≤4: any pattern works. 5–7: prefer stagger or rolling. 8+: crossfade is usually forced.
- **Scene density** - busy background eats stale captions; accumulate only works when backdrop is clean enough that older captions stay legible.
- **Clip length** - ≥12s erodes accumulation (viewer loses connection to earliest caption); prefer stagger or rolling for long clips.

Write the reasoning in `_notes` in plan.json so the decision is inspectable and the agent's intent survives into review. e.g.:

```json
"_notes": "Morning_Jog: 5 groups in 8s. Narrative is crescendo (Okay→honestly→changed my life→KIDDING), and background is clean (trees, sky). Accumulate-through-climax - all 4 earlier groups stay visible so KIDDING lands on top of a built-up poem. Cascading right with varied top%/alignment so the stack reads as composition, not a subtitle column."
```

This is where per-case judgment earns its keep. The skill gives you a palette of patterns; the pick is yours.

### Spatial coherence - the main slot rule

**Every plan has ONE primary slot.** Most groups land there. Secondary slots exist only for intentional rhythm-breaks (once every ~30s, never per-chunk alternation). The old autogen rotation that threw each chunk to a different corner violated this and read as chaos.

Choose a primary slot based on scene:

- **9:16 portrait, subject mid-frame** → primary slot is `top: 4–20%` (sky / clean zone above the head). Secondary: `top: 72–78%` (below shoulders, above UI). Never: bottom 22% (UI/hand zone per [rule 17](aesthetic-principles.md)).
- **16:9 landscape, subject left** → primary slot is the right column (`left: 50–55%`, right-aligned or centered in the column). Secondary: below subject.
- **16:9 landscape, subject centered** → primary slot is `top: 10–20%` OR `top: 70–80%`. Pick one and stick.

Within the primary slot, vary **size and weight** to create hierarchy (narrator small, body mid, emphasis large, climax huge). That's the rhythm inside a coherent position. Secondary slots are for **break-rhythm moments**, not for adjacent chunks just to "avoid collision".

Collision validator still runs - but now the agent should be hitting it only in exceptional cases (intentional layering), not because every chunk is in a different place.

**Verbatim recipe** - every word is shown, but it is **not** a flat TikTok subtitle rail. Use the cinematic DNA: per-group typography variation, position variation, size modulation. Italic openers, upright pivots, uppercase climaxes, spatial cascade, per-word soft/present tones - all of it.

Chunking: walk the transcript and split into groups of **1–4 words** at pause boundaries (>0.25s gap = hard cut; within a phrase, chunk by emotional beat - short 1–2 word chunks for emphasis words, longer 3–4 word chunks for connective tissue).

Typography per chunk - treat each chunk as a mini-beat. The sizes below are a **starting palette, not rules.** The agent picks the actual `font-size` per group based on the scene's clean-zone width, the phrase's character count, and the desired visual weight relative to neighboring groups. Shift by ±30% whenever the scene demands (narrow portrait column → shrink; wide landscape hero → enlarge). Pick from [typographic-moves.md](typographic-moves.md):

- **Filler / connective** ("you know", "like", "so I was", pronouns, conjunctions) → italic 500–600, small (~0.05–0.08h starting point), softer tone, subordinate position. These read as narrator voice, not statement.
- **Emphasis / content words** (verbs, nouns carrying meaning) → upright 600–800, mid (~0.08–0.12h starting point), centered or cascaded position, present tone.
- **Climax / hook words** (the payoff word of the sentence) → uppercase 800–900, large (~0.14–0.22h starting point), full-frame or near-frame-width, present tone with scale pop.

**Size is always relative, never absolute.** What matters is the _contrast ratio_ between a group and its neighbors inside the same plane - climax should be ~2× the emphasis, emphasis ~1.3–1.5× the narrator. An agent that writes `0.08h / 0.08h / 0.08h` for three caps in a plane has failed regardless of which bucket it picked from. The hierarchy is the point.

Spatial composition: use the full frame as a canvas. Filler chunks tuck to corners or sit small at subordinate positions; emphasis chunks claim the middle; climax chunks own the frame. **Don't lock everything to `bottom: 12%`** - that's the boring-subtitle trap.

Time windows: either spatially-separate overlapping groups (cascade, poem-accumulation) or hand-off so only one chunk shows at a time. Handoff at the same slot reads jittery (too many cuts in a short window) - prefer spatial cascade where adjacent chunks coexist at different positions, or accumulation blocks bounded by sentences.

Layer: default `"bg"` for any chunk whose position has clean scene around it (sky, wall, the area above/below the subject) - that's the embed effect. Use `"fg"` only when the chunk's position would be ≥80% occluded by the body (e.g. chyron-style chunks at bottom in 9:16 portrait where the torso fills that zone).

**Climax chunks across the subject - readability first.** The Vogue-masthead effect (big uppercase crossing the body) is the most cinematic move, but only if the word is still readable. Use `bg` across the subject when **all** of:

1. The caption is multi-line (≥2 lines), so even if one line is mostly eaten, the others stay clean and the viewer can read the phrase. Single-line captions should never sit directly over the face/body - either reposition above/below the subject, or use `fg`.
2. The subject's bounding box covers ≤40% of the caption's total pixel area. For 9:16 portrait with a typical head-and-shoulders subject (~30% vertical × ~50% horizontal at mid-frame), a caption at `top: 16%` spanning 4 lines × 0.14h meets this - the face eats one line, the other three read clean. A caption at `top: 40%` sitting directly on the face does not.
3. Each individual word has visible letter endpoints on at least one side - a word that's split mid-letter with only interior strokes showing is unreadable even if "25% of total pixels" are covered.

If any of these fail, either **reposition** the BG caption to clean scene (above the head / below the shoulders / into an off-center corner), or **fall back to `fg`**. FG for climax is the right call when the scene has no clean zone big enough - don't force the embed aesthetic at the cost of legibility.

Rule of thumb: if you flattened your plan to just the climax chunks, the result should still read as a satisfying tweet-length headline. If it doesn't - you've under-varied your typography and the climax doesn't pop hard enough.
