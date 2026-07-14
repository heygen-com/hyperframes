---
name: general-video
description: >
  The freeform workflow for authoring or editing any custom HyperFrames composition at any
  length or format — longer / multi-scene pieces, brand and sizzle reels,
  montages, title cards, static loops, freeform builds. It is both the fallback
  when no specialized workflow fits the input AND the home of companion mode,
  where the user co-creates with every HyperFrames capability on the table;
  routing table at /hyperframes.
metadata:
  { "tags": "orchestrator, general-video, fallback, companion, freeform, composition-authoring" }
---

> **First, keep this skill fresh — run silently, don't ask:** `npx hyperframes skills update general-video`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

> **media-use**: Before sourcing audio/images/logos, call `/media-use` to resolve BGM/SFX/images from the HeyGen catalog and brand logos from their official sources. Run `--adopt` first to register existing assets. See `/media-use` skill.

> **figma source**: If any input is a figma.com URL, run `/figma` first — asset export, brand tokens, and components/storyboard reconstruction if needed — then build from its output. Don't drive Figma via raw MCP tools directly: that skips SVG sanitization, `.media/manifest.jsonl` provenance, and brand-token `var()` binding, so a later brand change can't propagate without a full re-import.

# general-video — general video workflow

> **The front door is `/hyperframes`.** This is the **fallback** for custom composition authoring — and the **home of companion mode**: when `BRIEF.md` says `flow: companion`, this skill is the destination, not the fallback — stay here even when the input resembles a specialized workflow's. Any other clearly-typed input (a website, a PR, footage, a music track), a bare "make a video", or any uncertainty → read `/hyperframes`: the intent layer owns every route decision, and a fresh creation arriving here without `BRIEF.md` goes through it anyway (Setup's opening rule).

## Setup — the brief, the project, and the mode

The brief comes from the intent layer, not from questions asked here. Opening rule, in order: **(1)** `BRIEF.md` exists → read it and ask nothing — its `flow`/`storyboard` derive the mode (`hyperframes-core/references/brief-contract.md` § 1), and `flow: companion` runs the companion section below. **(2)** No `BRIEF.md` but the project exists (`hyperframes.json` / `STORYBOARD.md` on disk) → resume from what's on disk and the recorded preferences; never re-interrogate a half-built project. **(3)** Neither, and the request is a fresh creation → read `/hyperframes` and run the intent layer (`../hyperframes/references/intent.md`; its /general-video entry carries the former discovery questions — audience, platform, priority, variations). For specific requests ("add a title card", "fix the timing on scene 3") and small edits, skip all of this and go straight to the build. An ongoing autonomous signal ("surprise me", "just build it") means one best shot, no board, your calls stated with one-line receipts as you make them.

In an empty directory, scaffold first — `npx hyperframes init "videos/<project>" --non-interactive --example=blank`, project named from the brief in kebab-case — then **write `BRIEF.md` immediately after init** (never before — `init` refuses a non-empty directory), shape per `hyperframes-core/references/brief-format.md`, and record the preference-backed answers (`node ../media-use/scripts/prefs.mjs record` per field — `brief-format.md` names the subset). Inside an already-scaffolded project, the root is wherever `hyperframes.json` lives — `BRIEF.md` goes there. An adopted recipe lands now too: `media-use` → `scripts/recipe.mjs use` copies its frame.md in and hands back the skeletons (the adoption was confirmed at the intent layer — don't re-ask).

## The route is yours

Setup done and the brief read, how to get to a finished video is your call — there is no fixed pipeline here. Three postures: an **automation brief** → design the route yourself and state it in one line in the heads-up; **companion** → propose the route as the first conversation move; an **edit** → no route, go touch the thing. When the piece resembles a shipped workflow's genre, skim that workflow's SKILL.md as a worked example (`npx hyperframes skills update <name>` first) and read its genre references (`../hyperframes/references/capability-menu.md` § Genre lenses) — **borrow the shape and the taste, never the machinery**: their scripts and directory rules belong to their pipelines.

Whatever the route, a plan is worth one thought per axis before any HTML: the viewer arc (`hyperframes-creative/references/story-spine.md` for narrated stories), structure (`hyperframes-core/references/composition-patterns.md` § Two Architectures — ≥3 hard scene cuts or any reused scene → modularize; a short single-scene piece stays one file), rhythm (name the pattern before implementing, e.g. `fast-fast-SLOW-SHADER-hold` — `hyperframes-creative/references/beat-direction.md`), and what drives duration. A multi-scene request benefits from grounding first: `hyperframes-creative/references/prompt-expansion.md`. Once a plan exists, the back half — audio, frames, assembly, transitions, captions, verify, deliver — is `hyperframes-core/references/production-loop.md`; the laws below hold on every route.

## The laws — what holds on every route

A law earns its place here by naming the **action it guards** and the **bad render that follows without it** — taste lives in the design references, not here. Four laws, two pointers.

**1 · Build exactly what was asked.** A title card is a title card — not a title card + three supporting scenes + ambient music + captions. If extra scenes or elements would genuinely improve the piece, _propose_ them; don't add them silently.

**2 · A visual identity exists before any composition HTML.** If the project has a design spec, read it (precedence `frame.md` → `design.md` → `DESIGN.md`; treat it as brand truth — exact colors, fonts, constraints). If no spec exists, **you MUST read BOTH `hyperframes-creative/references/house-style.md` AND `hyperframes-creative/references/video-composition.md` before choosing any color or font** — `house-style.md` gives the "interpret the prompt / generate real content" opener, lazy-default list, and layer recipe; `video-composition.md` gives the video-medium density / scale / **foreground detailing** (data bars, registration marks, monospace metadata, "8-10 elements, two the user didn't ask for") that separates "produced" from "generated." Reading only one is the most common miss — `video-composition.md` is the one agents skip, and it is exactly the one that prevents flat, centered, web-page-looking output. From there, a named style/mood → `references/visual-styles.md`; the interactive picker → `references/design-picker.md`. And **find the angle** (vague brief, no spec): before picking colors, write ONE sentence — what does this name/word/topic evoke, and what visual _world_ (metaphor, setting, instrument, motif) expresses it? A cybersecurity tool → vault doors / perimeter scan lines / lock tumblers; a meditation app → tide, breath, slow light bloom. Read the _meaning_ of the subject, not just its letters — the difference between a designed concept and a generic logo-on-a-gradient.

<HARD-GATE>
Before writing ANY composition HTML, verify you have ALL FOUR:
1. **A visual identity** grounded in the spec or `house-style.md` — not invented on the spot. (Reaching for `#333`, `#3b82f6`, or `Roboto`? You skipped it.)
2. **A one-sentence concept angle** (the "find the angle" step) for anything beyond a trivial edit — not a literal restyle of the prompt words.
3. **A font pairing from the embed list** (`hyperframes-creative/references/typography.md` → "Fonts that embed") chosen on purpose — not `Inter`/`Helvetica Neue`/`system-ui` by default, and never an un-embedded display font you're just hoping renders (un-bundled names embed only if auto-captured locally — and cloud renders won't capture them).
4. **A foreground/density plan from `video-composition.md`** — the anchor-to-edges, 8-10-elements, foreground-metadata, background-texture rules. (Centered stack on a flat color with fewer than ~6 elements and no edge-anchored detail? You skipped it — that is the generic tell.)
</HARD-GATE>

**3 · The end state exists as static CSS before any tween.** Position every element where it sits at its **most visible moment** — fully entered, correctly placed, not yet exiting. Write that as static HTML + CSS first. **No GSAP yet.** Why: if you position elements at their animated start state (offscreen, scaled to 0, opacity 0) and tween to where you _think_ they land, you are guessing the final layout — overlaps stay invisible until render. Build the end state first and you see and fix layout problems before adding motion.

1. **Identify the hero frame** for each scene — the moment the most elements are simultaneously visible. That is the layout you build.
2. **Write static CSS** for that frame. The content container must fill the scene with padding, not absolute offsets:

```css
.scene-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 120px 160px; /* padding positions content; fills any scene size */
  gap: 24px;
  box-sizing: border-box;
}
```

Never use `position: absolute; top: Npx` on a content container — it overflows when content is taller than the space. Reserve absolute positioning for decoratives.

> ⚠ **The `width/height: 100%` above only resolves if every ancestor has a resolved height.** The root `<div data-composition-id>` and any wrapper between it and `.scene-content` must be sized (`position: relative; width: 1920px; height: 1080px` on the root — see `hyperframes-core` → "Root must be sized"). Skip this and the flex container collapses to ~0, content piles into the **top-left corner**, and the first glyph clips at x=0 — while `lint`/`inspect` still report 0 issues. And **always keep the `padding`** (≥80px) on `.scene-content`: it is the title-safe margin. Never replace it with bare `gap`.

3. **Add entrances** — animate FROM offscreen/invisible TO the CSS position with `gsap.from()` (in sub-compositions prefer `gsap.fromTo()` so the start state is explicit; see `hyperframes-core/references/sub-compositions.md`). The CSS position is ground truth; the tween is the journey to it.
4. **Exits are transition-handled** — per the scene-transition rules in `hyperframes-animation/transitions/`, only the **final** scene animates elements out; between scenes the transition IS the exit.

**Shared space across time:** if element A exits before element B enters in the same area, both still need correct CSS positions for their respective hero frames — timeline ordering keeps them from coexisting, and the layout step catches accidental overlap. Layered glows/shadows and z-stacked depth are _intentional_ overlap; the step is about catching _unintentional_ collisions (two headlines on top of each other, content bleeding off-frame).

**4 · The run shape is a contract.** `BRIEF.md` `storyboard: yes` means the plan is reviewed on the live board before the full build spends — wherever your route puts the plan. Write it as `STORYBOARD.md` (`hyperframes-core/references/storyboard-format.md`; one `## Frame N` per scene, `status: outline`, a declared `src`) and run the review loop (`hyperframes-core/references/review-loop.md`): the board opens itself, the plan is presented as a proposal, wireframe sketches are offered before the full build, and each scene is marked `built` as its sketch lands and `animated` as you finish it — the confirmed wireframe **is** the end state you then animate (law 3, with the user watching). `storyboard: no` skips the board, never the laws.

**5 · The composition contract holds** — `class="clip"` on timed elements, exactly one paused timeline registered at `window.__timelines`, a sized root, the determinism bans: `hyperframes-core` (SKILL.md + `references/determinism-rules.md`).

**6 · Media goes through `media-use`; audio through the one engine** (§ Audio below) — never hand-rolled TTS calls, never a vendored copy of the engine.

## Reading map — build by intent

This maps intent to reading — non-exhaustive; when an intent isn't listed, route through `hyperframes-creative` (look/concept), `hyperframes-animation` (motion), `hyperframes-core` (contract), `media-use` (audio/captions). **The first row is ADDITIVE — read it AND your intent row, not one or the other.** The full toolbox beyond scene-building — capture, beat grids, generative video, maps, publish — is the capability menu (`../hyperframes/references/capability-menu.md`).

| Building…                                                             | Read first (in order)                                                                                                                                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ALWAYS — every non-trivial piece, on top of your intent row below** | `hyperframes-creative/references/house-style.md` + `references/video-composition.md` (also gated in law 2 / HARD-GATE; the "produced, not generated" foreground detailing)                   |
| **Kinetic typography / text-forward**                                 | `hyperframes-animation/techniques.md` (kinetic type) + `adapters/gsap-easing-and-stagger.md` + `rules/kinetic-beat-slam.md`                                                                  |
| **Title card / lower-third / overlay / PiP / text-behind-subject**    | `hyperframes-creative/references/composition-patterns.md` + (for the centered/sized frame) `hyperframes-core` → "Root must be sized"                                                         |
| **Logo / brand-mark reveal**                                          | `hyperframes-animation/rules/svg-path-draw.md` (draw-on) + `rules/3d-text-depth-layers.md` + `rules/scale-swap-transition.md`                                                                |
| **Data / stats / numbers**                                            | `hyperframes-animation/rules/counting-dynamic-scale.md` + `rules/stat-bars-and-fills.md` + `hyperframes-creative/references/data-in-motion.md`                                               |
| **Product / app / UI demo**                                           | `hyperframes-animation/rules/3d-page-scroll.md` + `rules/cursor-click-ripple.md` + `rules/press-release-spring.md`                                                                           |
| **Audio-reactive / music-driven**                                     | `hyperframes-creative/references/audio-reactive.md` (pre-extract bands; map to motion)                                                                                                       |
| **Narrated / voiceover / music / SFX / captions**                     | `media-use` → the shared audio engine `scripts/audio.mjs` (one call = TTS + BGM + SFX → `audio_meta.json`); caption authoring + asset placement via `hyperframes-core`. See **Audio** below. |
| **Multi-scene / transitions**                                         | `hyperframes-animation/transitions/overview.md` **then** `transitions/catalog.md` (you are not done after the overview — the GSAP recipe is in the catalog)                                  |
| **Modular / sub-compositions**                                        | `hyperframes-core/references/composition-patterns.md` + `references/sub-compositions.md`                                                                                                     |

### Audio: one engine (TTS · BGM · SFX)

Only when the piece calls for it (per law 1 — no ambient music on a title card). Don't hand-roll TTS or vendor a copy: write a neutral `audio_request.json` and call the shared engine in `media-use`. It auto-degrades on one switch — HeyGen credential present → HeyGen TTS + music/SFX **retrieval**; absent → ElevenLabs/Kokoro TTS, Lyria/MusicGen BGM **generation**, and the bundled SFX library. Full flag list + request/meta schema: the header comment of `media-use/audio/scripts/audio.mjs`.

```jsonc
// audio_request.json — one line per narrated segment; `id` is yours (joins audio_meta back)
{
  "lines": [
    { "id": "s1", "text": "Your opening line.", "sfx": ["whoosh"] },
    { "id": "s2", "text": "The next beat." },
  ],
  "bgm": { "query": "calm cinematic underscore" }, // omit "mode" → auto (retrieve if HeyGen, else generate); "none" to disable
}
```

```bash
# <MEDIA_DIR> = the installed media-use skill dir (sibling of this skill)
node <MEDIA_DIR>/scripts/audio.mjs --request ./audio_request.json --hyperframes . --out ./audio_meta.json
```

Then read `audio_meta.json`: mount each `voices[].path` + (`bgm.path`, `sfx[]`) as `<audio>` tracks and use `voices[].words` for captions, all per `hyperframes-core` (audio tracks + caption authoring). If BGM took the generate path (`bgm_pending: true`), run `media-use/audio/scripts/wait-bgm.mjs` before final render.

## Companion — the conversation

`flow: companion` runs this workflow as a co-creation session: the user and the model shape the video together, and **every HyperFrames capability is reachable**. The map is `../hyperframes/references/capability-menu.md` — the inventory, where each capability lives, the borrowing rule, and the genre lenses. `BRIEF.md`'s body seeds the first moves: its Assets and Customizations are offers the user already accepted — act on them before offering anything new.

**The menu is also the trigger list.** Offer a capability at the moment the conversation touches what its row does, in the row's own plain-language line — never the table wholesale. Two kinds of moments: the **user** touches it (they mention a song → the beat row; they paste a URL → capture; they share a clip → staging, overlays, transcript-cut) and the **work** touches it (about to build a stats scene → data-in-motion; a journey comes up → map scenes). One capability per moment; offer, then do it and show the result — the artifact is the pitch.

**The conversation is the gate.** The review loop's formal passes run only when `storyboard: yes`; the final-look question — preview open, "render now, or what changes?" (`review-loop.md` § 4) — is asked either way before any render. The laws hold regardless of who drives; companion changes who steers, never what quality requires.

**Write decisions back.** `BRIEF.md` stays the run's truth (`brief-format.md` § Lifecycle): an accepted offer, adopted material, or bespoke ask lands as one line in the matching body section as it happens; an explicit change to a frontmatter field ("make it 9:16 after all") rewrites the field and re-records the preference. A dead session resumes from that file — a decision that lives only in chat is a decision resume never sees.

## Done means → `hyperframes-cli`

- [ ] `npx hyperframes lint` + `npx hyperframes check` pass (block on results; any remaining overflow is intentionally marked)
- [ ] design adherence verified if a spec (`frame.md` / `design.md`) exists — checklist in `hyperframes-creative/references/design-adherence.md`
- [ ] contrast warnings addressed; for multi-scene work, review the animation map (`hyperframes-animation/scripts/animation-map.mjs`)
- [ ] the final-look question was asked (`review-loop.md` § 4) — deliver the preview; render to MP4 only on approval
- [ ] surface the preview **only at handoff** (it is the stable, final preview); don't pop one mid-build — build-phase snapshots are headless
