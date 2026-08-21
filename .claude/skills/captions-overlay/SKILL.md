---
name: captions-overlay
description: Overlay doctrine for the embedded-captions workflow — the caption MODEL (drop / rail / embed) and the rule that captions are an OVERLAY composited on top of the film, never a reserved bottom band you shift content up to avoid. Load when adding captions/subtitles to a talking-head or launch video, when deciding whether a phrase should be dropped, ride the verbatim rail, or be promoted to a scarce embedded climax, when laying out a composition that will carry captions (do NOT reserve a keep-out band), or when centering a composition on the true frame center under captions. Quotes the rail+embed model from embedded-captions and constraint #13 (captions overlay, keep-out band retired) from the product-launch-video scene agent. Applies ON TOP of embedded-captions.
---

# Captions Overlay Doctrine

> **Overlay doctrine — supplements the upstream `embedded-captions` skill. Applies ON TOP of it; do not expect it folded into the upstream skill.**

Two ideas combine here. First, the **caption model** — every spoken phrase is `drop`,
`rail`, or `embed`, and embed is the scarce earned peak, not the default. Second, the
**overlay law** — a caption line is composited ON TOP of the film as an overlay; it is
NOT a reserved zone, so you never shift content up or leave a dead band to "make room"
for it. The two reinforce each other: because captions ride as an overlay (the verbatim
rail in front, the occasional embed behind the subject), the composition keeps its full
frame and centers on the true vertical center.

## The caption model — drop / rail / embed

Every spoken phrase is one of three things (verbatim from `embedded-captions`):

|           | What                                             | How it's shown                                                                                                                                                    |
| --------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **drop**  | filler — um/uh, stutters, self-corrections       | not shown                                                                                                                                                         |
| **rail**  | the default — ordinary spoken content (verbatim) | clean lower-third subtitle, **in front**, readable. A punch word can get an inline `emphasis` highlight (accent colour / active-word pop) — it stays on the rail. |
| **embed** | a promoted peak — the headline beat              | one big word composited **behind the subject** (matte occlusion), designed entrance + exit                                                                        |

**The rail carries most of the text; embed is the scarce, earned peak** — ≤1 per beat,
never two adjacent/co-visible, spaced ≥ a beat apart. A short clip → usually one embed;
a long explainer → ~one per section. Embedding every word is the common mistake.

This is the **Standard** mode shape (rail = the verbatim lower-third; embed = the climax
composited behind the subject). **Cinematic** mode drops the rail and makes everything
embed-style — use it only for pure-cinematic asks, never for explainer / voiceover where
the words must read.

### Rail-first, embed-scarce (the load-bearing rules)

Quoted from the `embedded-captions` non-negotiables:

- **Rail-first for talking-head / explainer.** Don't embed the whole transcript — most
  text is the rail; embed only peaks. Embedding everything is the default mistake.
- **Embed is scarce + spaced.** ≤1 embed per sentence/beat, never two adjacent or
  co-visible, ≥ a beat apart, at most one `apex`. climax = per-beat peak, **not** "the
  single payoff of the entire clip."

## The overlay law — captions are NOT a reserved band

In a generated launch composition, when captions are enabled, finalize composites a
**small, minimal word-by-word caption line** as an overlay layer ON TOP of the whole
film (a single text line, bottom-centered, roughly the bottom ~5-8% of canvas height).
It is an overlay, not a reserved zone (verbatim from constraint #13 of the
product-launch-video scene agent):

- **Center the composition on the TRUE vertical center — y = H / 2** (landscape 540,
  portrait 960). Do not shift content up to "make room" for captions; a composition
  centered at 0.42 × H with a dead lower band is the bug, not the fix.
- Content may extend to the canvas bottom. Full-bleed subjects, rails, and backgrounds
  all welcome.
- **One soft courtesy rule:** avoid parking _critical small readable text_ (a URL line,
  a legal line, a sub-caption) exactly in the bottom ~80px center span where the caption
  line sits — the overlay would fight it. Large imagery / cards / ambient content under
  the captions is fine; the caption skin is designed to read over content.
- There is no machine keep-out gate (the old `captions.mjs keepout` check is retired).
  Finalize snapshot QA judges caption-over-content legibility visually.

**When captions are disabled:** identical positioning freedom — the overlay simply
doesn't exist.

## Why these two rules are one doctrine

The model says the rail rides **in front** and an embed is a rare word composited
**behind the subject** — both are layers added to footage that ships untouched. The
overlay law says the caption line is a layer composited **on top** of the whole film,
not a band carved out of the layout. So in both the captioning pipeline and the
launch-video pipeline, captions are an overlay you add, not a zone you reserve:

- Keep the full frame; center on true center; let content run to the edges.
- Make the rail (or the small overlay caption line) carry the verbatim words.
- Promote a word to an embed only at a genuine peak — scarce, spaced, never two at once.
- Reserve nothing; judge legibility of captions-over-content visually, not by a keep-out gate.
