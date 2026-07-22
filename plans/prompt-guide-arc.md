# Prompt Guide arc restructure — novice → capstone

Status: approved design 2026-07-22. Owner: Vance. Supersedes the _structure_ of
`plans/prompt-guide-expansion.md` (its content and validation rule carry over unchanged).
Lands on `fix/prompt-guide-validation-bugs`, amending PR #2109.

## Why

Reviewer feedback on the 29-page guide: it reads as a reference manual — "how to do
specific things with prompts" — with no story in the hierarchy. The fix: restructure as a
progression from novice to advanced where each section builds on techniques learned in the
prior one, culminating in the most advanced artifact a reader can build with everything
the guide teaches.

Structure model ("full dissolve"): no standalone by-video-type / by-feature reference
sections survive. Every page becomes a chapter at the level where the reader is ready for
it, with an entry bridge ("you can now X") and an exit bridge ("next you'll Y").

## The capstone (design target — everything builds to this)

A new, public, promo-style film about HyperFrames itself ("write HTML, render video"),
~45–60s, 6–8 frames. It is the "final form": the artifact only a reader who has absorbed
every level can prompt into existence. Modeled on the internal promo compositions
(`videos/team-vault-explained`, `~/src/videos/hyperframes-infra-proposals`) — the proven
advanced stack:

- `frame.md` design system: strict two-color palette discipline, negative list,
  permanent grid/chrome that rides every frame
- Storyboard with narrative arc, VO-paced reveals (each element lands on its spoken cue),
  persuasion/beat columns, a callback (early motif returns denser late), one breather frame
- TTS narration + BGM at the fixed bed level (post-#2110 default)
- One generated-artwork hybrid frame (illustration-led → generated raster + code-layer
  animation), one data-viz frame, one code frame
- Matched-motion transition between at least one frame pair
- Variables re-skin: default vs overridden render pair
- Full `lint` / `check` / render validation; built for real in
  `~/src/hyperframes-prompt-examples/capstone/`; renders hosted on static.heygen.ai

The capstone chapter walks brief → design system → storyboard → per-frame build →
validate → render, and each step links back to the level that taught it. The finished
MP4 is also embedded in the overview intro as the guide's promise ("by the end you can
build this").

## Level structure and page mapping

Nav: the `Prompt Guide` top-level group's subgroups become levels.

| Level | Title            | Chapters (existing page → new role)                                                                                                                                                                                                                   |
| ----- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —     | Start here       | `overview` — rewritten: the arc's map, skill setup, capstone teaser embed                                                                                                                                                                             |
| L1    | Your first video | Workflow rides, one prompt + embedded render each: `product-launch`, `explainers`, `code-and-prs` (gains changelog-video), `captions-and-talking-heads`, `music-and-slideshows`, `motion-graphics`                                                    |
| L2    | Control          | `anatomy`, `specification-dial`, `vocabulary`, `visual-specs`; `examples` becomes the level-end gallery (18 dissections)                                                                                                                              |
| L3    | Life             | `motion` (grammar + measured A/B), `transitions`, seeded-motion rule 7 material                                                                                                                                                                       |
| L4    | Substance        | Capability chapters framed as "add this to what you have": `code-blocks`, `data-and-maps`, `overlays-and-lower-thirds`, `captions-catalog`, `generated-artwork`, `vfx-and-liquid-glass`, `runtimes-and-3d`                                            |
| L5    | Voice & sound    | `media-and-audio` expanded with the media-proxy subsystem (see New topics)                                                                                                                                                                            |
| L6    | Scale            | `design-systems`, `variables-and-templating` (+ CSS-shadow fix), **storyboards** (new chapter, extracted from internal-promo practice), `editing-existing-videos`, `iterating`, `recreating-references`, `rendering-and-output`, `remotion-migration` |
| L7    | Capstone         | New chapter as specified above                                                                                                                                                                                                                        |
| —     | Appendix         | `rules-and-anti-patterns` kept as the consolidated cheat sheet; each rule is _also_ taught in-context at its level                                                                                                                                    |

Page count: ~30 (29 existing, minus none, plus storyboards + capstone; overview rewritten).
Keep page counts out of prose (standing drift rule).

## New topics (landed on main after the guide was written, Jul 9–22)

1. **Media proxy subsystem** → L5 chapter section: HEVC/hostile-codec probe, automatic
   bounded H.264 and alpha-capable authoring proxies, serving from preview/play/static
   server, baking into published archives, project opt-out, runtime swap of undecodable
   video (#2585–#2598 range).
2. **New lint rules** → taught at the level where each gotcha becomes relevant AND listed
   in the appendix: seek-order safety, SVG draw-on rules, relative-value second writers,
   `tl.set` initial hides, cold-seek opacity reveals (#2503, #2612, f3d210066).
3. **Composition-structure mandate block** (#2599, 0aaac7aa3) → L2 anatomy context.
4. **changelog-video skill** (e96ebd74d) → L1 code-and-prs chapter.
5. **Variables no longer shadow authored CSS custom properties** (406894061) → L6
   variables chapter correction.

## Validation

Standing rule unchanged: no prompt ships unverified. Existing 64 renders are reused
wherever the prompt text survives the move verbatim. New validation builds required for:
the capstone film (full pipeline), the proxy-chapter prompt, new-lint-gotcha examples,
and the storyboard-chapter example. Same bar: built exactly as written by a builder
agent, lint/check pass, render embedded.

## Mechanics

- All work on `fix/prompt-guide-validation-bugs` in worktree
  `~/src/wt/hyperframes/prompt-guide`; PR #2109 description updated to describe the arc.
- `docs.json` nav rewritten to the level groups; Mintlify redirects for any `prompting/*`
  slug that moves; the existing `guides/prompting` → `prompting/overview` redirect stays.
- Renders synced via `scripts/upload-docs-images.sh` (S3, `docs/images/` stays gitignored).
- Fix the currently red Format CI check on the branch while in there.

## Out of scope

- Tier 3 registry-block overhauls (issue #2107) — unchanged.
- HeyGenVerse article resync / llms.txt check — post-deploy follow-ups as before.
- No behavior changes to skills or pipeline (that was PR #2110, merged).
