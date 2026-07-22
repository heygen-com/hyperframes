# Prompt Guide Arc Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the 29-page Prompt Guide from a reference manual into a novice→advanced arc (spec: `plans/prompt-guide-arc.md`) where each level builds on the prior one and ends in a validated capstone film.

**Architecture:** Pages keep their slugs (`docs/prompting/*.mdx`) — only `docs.json` grouping, page content framing, and two new pages (`storyboards`, `capstone`) change. Content rewrites are per-level editorial passes with a fixed bridge template. New prompts follow the standing validation protocol (built as written → lint/check → render → embed).

**Tech Stack:** Mintlify docs (`docs/`), oxfmt/oxlint, HyperFrames CLI validation builds, S3 render hosting via `scripts/upload-docs-images.sh`.

## Global Constraints

- All work in worktree `~/src/wt/hyperframes/prompt-guide` on branch `fix/prompt-guide-validation-bugs` (PR #2109). Commit with `/usr/bin/git` (the `rtk` proxy silently no-ops commits). Conventional commits; header ≤ 100 chars.
- **No prompt ships unverified.** Every NEW prompt printed in the guide must pass the Validation Protocol below before its page is committed. Existing prompts keep their existing 64 embedded renders; do not rewrite a validated prompt's text (rewriting voids its render).
- **Bridge template** — every chapter page gets both:
  - Entry bridge: first paragraph after the frontmatter opens with what the reader can already do, then what this chapter adds. Pattern: `You can already <prior-level skill>. This chapter adds <this chapter's skill>.` (Adapt the wording per page; keep the two-beat shape.)
  - Exit bridge: final line of the page, italic: `*Next: [<next chapter title>](/prompting/<next-slug>) — <one clause on what it adds>.*` The last chapter of a level points at the first chapter of the next level.
- Keep page counts out of prose (drift rule). Never say "29 pages" / "30 pages" in any `.mdx`.
- Embed snippet for renders (copy exactly, swap filename):
  ```mdx
  <video
    controls
    muted
    loop
    playsinline
    preload="metadata"
    src="https://static.heygen.ai/hyperframes-oss/docs/images/prompting/<name>.mp4"
    style={{ borderRadius: "0.5rem", marginTop: "0.75rem" }}
  ></video>
  ```
- `docs/images/` is gitignored by design — renders go to S3 via `bash scripts/upload-docs-images.sh` (AWS profile `engineering-767398024897`), then verify each URL: `curl -sI <url> | head -1` → `HTTP/2 200`.
- After editing any file: `bunx oxfmt <files>` then `bunx oxlint <files>`. Markdown/MDX gets oxfmt only.
- Docs sanity gate (run before every commit that touches `docs/`):
  ```bash
  cd ~/src/wt/hyperframes/prompt-guide
  python3 -c "import json; json.load(open('docs/docs.json')); print('docs.json ok')"
  cd docs && npx mintlify broken-links
  ```
- Do not modify `.gitignore`. Do not close or open PRs. Push only in the final task.

## Validation Protocol (for every NEW prompt)

Used by Tasks 3, 7, 8, 9, 10. The executor dispatches a fresh builder subagent per prompt:

1. `mkdir -p ~/src/hyperframes-prompt-examples/guide-v3/<name>`
2. Dispatch a `general-purpose` subagent with EXACTLY this framing: "You are a HyperFrames builder. Your entire brief is the prompt below, verbatim — do not use any knowledge of why this prompt exists. Work in `~/src/hyperframes-prompt-examples/guide-v3/<name>`. Follow the `/hyperframes` skill routing. The project must pass `npx hyperframes lint` and `npx hyperframes check`, then render an MP4. Report the render path and any prompt ambiguity you had to resolve yourself." + the prompt text.
3. If the builder reports ambiguity or a gate failure caused by the prompt text: fix the page's prompt, re-run with a fresh subagent. The page ships the text that passed.
4. Copy the render: `cp <render>.mp4 ~/src/wt/hyperframes/prompt-guide/docs/images/prompting/<name>.mp4`
5. Upload + verify (see Global Constraints), embed under the prompt with the standard snippet and a one-line italic caption stating it is the unedited render of the prompt above.

---

### Task 1: Fix the red Format CI check

**Files:**

- Modify: `plans/prompt-guide-expansion.md` (formatting only)

- [ ] **Step 1: Reproduce**

```bash
cd ~/src/wt/hyperframes/prompt-guide && bun run format:check
```

Expected: FAIL listing `plans/prompt-guide-expansion.md`.

- [ ] **Step 2: Fix**

```bash
bunx oxfmt plans/prompt-guide-expansion.md
```

- [ ] **Step 3: Verify**

```bash
bun run format:check
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add plans/prompt-guide-expansion.md
/usr/bin/git commit -m "chore: format prompt-guide-expansion plan (fixes Format CI)"
```

---

### Task 2: Restructure docs.json nav into levels

**Files:**

- Modify: `docs/docs.json` (the `Prompt Guide` group only)

**Interfaces:**

- Produces: the level grouping every later task's pages live in. Slugs unchanged; no new redirects needed (the existing `/guides/prompting` → `/prompting/overview` redirect stays untouched).

- [ ] **Step 1: Replace the Prompt Guide group's subgroups**

In `docs/docs.json`, find the group `"Prompt Guide"` and replace its `pages` array with:

```json
[
  "prompting/overview",
  {
    "group": "Level 1 — Your first video",
    "pages": [
      "prompting/product-launch",
      "prompting/explainers",
      "prompting/code-and-prs",
      "prompting/captions-and-talking-heads",
      "prompting/music-and-slideshows",
      "prompting/motion-graphics"
    ]
  },
  {
    "group": "Level 2 — Control",
    "pages": [
      "prompting/anatomy",
      "prompting/specification-dial",
      "prompting/vocabulary",
      "prompting/visual-specs",
      "prompting/examples"
    ]
  },
  {
    "group": "Level 3 — Life",
    "pages": ["prompting/motion", "prompting/transitions"]
  },
  {
    "group": "Level 4 — Substance",
    "pages": [
      "prompting/code-blocks",
      "prompting/data-and-maps",
      "prompting/overlays-and-lower-thirds",
      "prompting/captions-catalog",
      "prompting/generated-artwork",
      "prompting/vfx-and-liquid-glass",
      "prompting/runtimes-and-3d"
    ]
  },
  {
    "group": "Level 5 — Voice and sound",
    "pages": ["prompting/media-and-audio"]
  },
  {
    "group": "Level 6 — Scale",
    "pages": [
      "prompting/design-systems",
      "prompting/variables-and-templating",
      "prompting/editing-existing-videos",
      "prompting/iterating",
      "prompting/recreating-references",
      "prompting/rendering-and-output",
      "prompting/remotion-migration"
    ]
  },
  {
    "group": "Appendix",
    "pages": ["prompting/rules-and-anti-patterns"]
  }
]
```

Notes: `prompting/storyboards` is added to Level 6 (before `editing-existing-videos`) in Task 9 when the file exists; `prompting/capstone` is added as a `"Level 7 — Capstone"` group between Level 6 and Appendix in Task 11. Mintlify fails on nav entries whose files don't exist yet — that's why they're deferred.

- [ ] **Step 2: Verify**

Run the docs sanity gate (Global Constraints). Expected: `docs.json ok`, no broken links.

- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/docs.json
/usr/bin/git commit -m "docs(prompting): regroup Prompt Guide nav into novice-to-advanced levels"
```

---

### Task 3: Level 1 — workflow-ride rewrites (6 pages)

**Files:**

- Modify: `docs/prompting/product-launch.mdx`, `docs/prompting/explainers.mdx`, `docs/prompting/code-and-prs.mdx`, `docs/prompting/captions-and-talking-heads.mdx`, `docs/prompting/music-and-slideshows.mdx`, `docs/prompting/motion-graphics.mdx`

**Interfaces:**

- Consumes: nav order from Task 2 (bridge targets follow that order: product-launch → explainers → code-and-prs → captions-and-talking-heads → music-and-slideshows → motion-graphics → anatomy).
- Produces: L1 framing later levels refer back to ("you rode a workflow; now open the hood").

**Editorial contract (each page):**

1. Reframe the page intro as a _first win_: one prompt to the workflow gets a finished video; the page's first validated prompt + its existing render move to the top.
2. Keep every existing validated prompt and embed verbatim (moving them on the page is fine; editing their text is not).
3. Existing "knobs that matter" material stays but moves after the first-win section, introduced as "what you can steer from the prompt before you've learned any technique."
4. Apply the bridge template. Entry bridge for `product-launch` (the arc's first chapter) instead states the level premise: you need zero technique to get a first video — one sentence describing your product is enough.
5. `motion-graphics` exit bridge points to `anatomy` and names the turn: "you've been riding workflows; Level 2 opens the prompt itself."

**`code-and-prs` additionally** gains a short "Changelog videos" section: the `changelog-video` skill (landed after the original guide) turns a repo's recent merges into a changelog video. Write one prompt for it and run the Validation Protocol with name `changelog-video` — the builder runs against the public `heygen-com/hyperframes` repo history so the render is publishable.

- [ ] **Step 1: Rewrite the 6 pages per the contract**
- [ ] **Step 2: Validate the new changelog-video prompt** (Validation Protocol, name `changelog-video`; embed render in `code-and-prs.mdx`)
- [ ] **Step 3: Format + docs sanity gate**

```bash
bunx oxfmt docs/prompting/product-launch.mdx docs/prompting/explainers.mdx docs/prompting/code-and-prs.mdx docs/prompting/captions-and-talking-heads.mdx docs/prompting/music-and-slideshows.mdx docs/prompting/motion-graphics.mdx
```

Then the docs sanity gate.

- [ ] **Step 4: Commit**

```bash
/usr/bin/git add docs/prompting/
/usr/bin/git commit -m "docs(prompting): Level 1 — reframe workflow pages as first-win rides + changelog-video"
```

---

### Task 4: Level 2 — Control rewrites (5 pages)

**Files:**

- Modify: `docs/prompting/anatomy.mdx`, `docs/prompting/specification-dial.mdx`, `docs/prompting/vocabulary.mdx`, `docs/prompting/visual-specs.mdx`, `docs/prompting/examples.mdx`

**Editorial contract:**

1. `anatomy` entry bridge: "your Level 1 prompts worked because the workflow filled the gaps; the skeleton is how you take that control yourself." Add one short paragraph noting the composition-structure mandate now enforced by the framework (main commit `0aaac7aa3` / PR #2599): compositions follow a required structural shape, so the skeleton isn't style advice — the framework soft-warns when structure drifts. No new prompt needed.
2. `examples` reframed as the level-end gallery: entry bridge frames the 18 dissections as "read these with your new vocabulary — spot the skeleton parts in each."
3. Chapter order for bridges: anatomy → specification-dial → vocabulary → visual-specs → examples → motion.
4. All existing prompts/renders/tables stay verbatim.

- [ ] **Step 1: Rewrite the 5 pages per the contract**
- [ ] **Step 2: Format + docs sanity gate** (`bunx oxfmt` the five files, then the gate)
- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/prompting/
/usr/bin/git commit -m "docs(prompting): Level 2 — control chapters with bridges + structure mandate note"
```

---

### Task 5: Level 3 — Life rewrites (2 pages)

**Files:**

- Modify: `docs/prompting/motion.mdx`, `docs/prompting/transitions.mdx`

**Editorial contract:**

1. `motion` entry bridge: "you can specify a frame precisely; this level makes it feel alive." Content (grammar, measured A/B, rule 7 seeded motion) already complete — bridges only.
2. `transitions` moves from feature-reference framing to "motion between scenes": entry bridge builds on the grammar ("rule 2's camera and rule 3's overlap apply _between_ scenes too"). Existing prompts/renders stay.
3. Bridge order: motion → transitions → code-blocks.

- [ ] **Step 1: Rewrite the 2 pages per the contract**
- [ ] **Step 2: Format + docs sanity gate**
- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/prompting/
/usr/bin/git commit -m "docs(prompting): Level 3 — life chapters with bridges"
```

---

### Task 6: Level 4 — Substance rewrites (7 pages)

**Files:**

- Modify: `docs/prompting/code-blocks.mdx`, `docs/prompting/data-and-maps.mdx`, `docs/prompting/overlays-and-lower-thirds.mdx`, `docs/prompting/captions-catalog.mdx`, `docs/prompting/generated-artwork.mdx`, `docs/prompting/vfx-and-liquid-glass.mdx`, `docs/prompting/runtimes-and-3d.mdx`

**Editorial contract:**

1. Every page reframes from "the X feature" to "add X to what you already have": the entry bridge names a Level 1-3 artifact the capability slots into (e.g. code-blocks → "your PR video from Level 1, now with a diff that types itself").
2. All existing prompts/renders stay verbatim.
3. Bridge order: code-blocks → data-and-maps → overlays-and-lower-thirds → captions-catalog → generated-artwork → vfx-and-liquid-glass → runtimes-and-3d → media-and-audio.

- [ ] **Step 1: Rewrite the 7 pages per the contract**
- [ ] **Step 2: Format + docs sanity gate**
- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/prompting/
/usr/bin/git commit -m "docs(prompting): Level 4 — capability chapters framed as additive"
```

---

### Task 7: Level 5 — media-and-audio + the proxy subsystem

**Files:**

- Modify: `docs/prompting/media-and-audio.mdx`
- Read for grounding: `git log main --oneline` commits `9ca1e1710`, `9d148d288`, `645880706`, `39b588cbd`, `74b4f1e8c`, `35eff5038`, `e8371a7ac`, `664c39db9`, and `docs/` pages touched by `5f2819b1e`, `8c1b6c515` (the existing proxy docs — link to them rather than duplicating mechanics).

**Editorial contract:**

1. Entry bridge: "your video moves and reads right; this level gives it a voice" — narration/TTS/BGM material stays.
2. New section "Bring any footage" covering the proxy subsystem _from the prompter's perspective_: you can now hand the workflow HEVC/HDR/odd-codec footage and preview/play/publish keep working — the framework probes codecs and builds bounded H.264 (and alpha-capable) proxies automatically; renders still use the original; `hyperframes lint` flags hostile codecs at info level; projects can opt out. Link to the concepts/media docs added by `8c1b6c515` for mechanics.
3. One new validated prompt exercising it: a prompt that builds a short picture-in-picture piece from a provided HEVC clip. Validation Protocol name `proxy-footage`; the builder gets a real HEVC test clip (generate one first: `ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30 -t 6 -c:v libx265 -tag:v hvc1 ~/src/hyperframes-prompt-examples/guide-v3/proxy-footage/source-hevc.mp4`) and the prompt references `source-hevc.mp4` by relative path.

- [ ] **Step 1: Ground against the proxy commits, then rewrite the page**
- [ ] **Step 2: Validate the proxy-footage prompt** (Validation Protocol; embed render)
- [ ] **Step 3: Format + docs sanity gate**
- [ ] **Step 4: Commit**

```bash
/usr/bin/git add docs/prompting/media-and-audio.mdx
/usr/bin/git commit -m "docs(prompting): Level 5 — voice, sound, and automatic media proxies"
```

---

### Task 8: Level 6 — Scale rewrites (7 pages)

**Files:**

- Modify: `docs/prompting/design-systems.mdx`, `docs/prompting/variables-and-templating.mdx`, `docs/prompting/editing-existing-videos.mdx`, `docs/prompting/iterating.mdx`, `docs/prompting/recreating-references.mdx`, `docs/prompting/rendering-and-output.mdx`, `docs/prompting/remotion-migration.mdx`

**Editorial contract:**

1. Level premise (design-systems entry bridge): "everything so far was one scene at a time; this level is about videos as systems — design that persists across scenes, edits that don't regress, output that ships."
2. `variables-and-templating`: add a correction note — composition variables no longer shadow authored CSS custom properties (main commit `406894061`); verify the page's existing wording against that commit's behavior and fix any sentence it invalidates. Existing default-vs-overridden render pair stays.
3. `remotion-migration` framed as "bringing an existing Remotion project into everything you now know," last chapter before the capstone level.
4. Bridge order: design-systems → variables-and-templating → storyboards (added in Task 9) → editing-existing-videos → iterating → recreating-references → rendering-and-output → remotion-migration → capstone (added in Task 11; until then point remotion-migration's exit bridge at rules-and-anti-patterns and fix it in Task 11).

- [ ] **Step 1: Verify the variables claim against `git show 406894061`, then rewrite the 7 pages**
- [ ] **Step 2: Format + docs sanity gate**
- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/prompting/
/usr/bin/git commit -m "docs(prompting): Level 6 — scale chapters + variables CSS-shadow correction"
```

---

### Task 9: New chapter — storyboards

**Files:**

- Create: `docs/prompting/storyboards.mdx`
- Modify: `docs/docs.json` (insert `prompting/storyboards` into Level 6 before `editing-existing-videos`), `docs/prompting/variables-and-templating.mdx` (exit bridge now points to storyboards)
- Source material: `videos/team-vault-explained/STORYBOARD.md` (in-repo), `~/src/videos/hyperframes-infra-proposals/STORYBOARD.md` — mine structure, not content.

**Editorial contract:**

1. Teach prompting _into_ a storyboard: for multi-scene work you don't prompt scenes, you prompt the plan — arc, per-frame beats, VO pacing — and the workflow builds frames against it.
2. Document the storyboard vocabulary the internal films prove, as prompt language: narrative arc line, VO-paced reveals ("at t=0 only what the narrator is saying is on screen; each element lands on its spoken cue"), persuasion/beat per frame, a callback (an early motif returning denser late), exactly one breather frame, a per-frame negative list. Do NOT reproduce internal film content — invent neutral examples.
3. One new validated prompt: a 3-frame mini storyboard piece (hook → substance → landing with callback), ~15s, no narration (keeps the build cheap). Validation Protocol name `storyboard-mini`; embed render.
4. Bridges: entry from variables-and-templating; exit to editing-existing-videos.

- [ ] **Step 1: Write the chapter per the contract**
- [ ] **Step 2: Validate the storyboard-mini prompt** (Validation Protocol; embed render)
- [ ] **Step 3: Add to nav, fix neighboring bridges, format + docs sanity gate**
- [ ] **Step 4: Commit**

```bash
/usr/bin/git add docs/prompting/storyboards.mdx docs/prompting/variables-and-templating.mdx docs/prompting/editing-existing-videos.mdx docs/docs.json
/usr/bin/git commit -m "docs(prompting): add storyboards chapter — prompting the plan, not the scenes"
```

---

### Task 10: Appendix — rules cheat sheet + new lint rules

**Files:**

- Modify: `docs/prompting/rules-and-anti-patterns.mdx`; plus one-sentence in-context mentions on `docs/prompting/motion.mdx` (seek-safety) and `docs/prompting/runtimes-and-3d.mdx` (SVG draw-on) where the gotchas bite.

**Editorial contract:**

1. Reframe as the consolidated cheat sheet: entry bridge says every rule here was taught in context — this page is the lookup table; each rule row links its teaching chapter.
2. Add the post-guide lint rules, phrased as prompt guidance (what to write / avoid so the build passes first try), each verified against its lint source before writing:
   - `gsap_cold_seek_hidden_fromto_missing_reveal` (#2503) — elements hidden at t=0 need an explicit reveal tween.
   - `gsap_callback_dom_measurement`, `gsap_function_value_hazard`, `gsap_repeat_refresh_relative_value`, `svg_drawon_css_dasharray_conflict`, `svg_measure_before_path_d` (#2611 / `f3d210066`) — seek-order safety and SVG draw-on.
   - `gsap_relative_value_second_writer`, `gsap_timeline_set_initial_hide` (#2612 / `4ad582606`).
     Ground each row: `git show <commit> -- packages/lint/src/rules/gsap.ts` and read the rule's message string; the guide row must match what the linter actually says.
3. Rows are prompt guidance, not prompts — but any row that prints a runnable example prompt must pass the Validation Protocol (name `lint-<rule>`); rows with phrasing-only guidance need no build.

- [ ] **Step 1: Ground each rule against lint source, write the rows + in-context mentions**
- [ ] **Step 2: Format + docs sanity gate**
- [ ] **Step 3: Commit**

```bash
/usr/bin/git add docs/prompting/
/usr/bin/git commit -m "docs(prompting): appendix cheat sheet + post-guide lint rules as prompt guidance"
```

---

### Task 11: Capstone film — build, validate, render

**Files:**

- Create (outside repo): `~/src/hyperframes-prompt-examples/capstone/` (brief, `frame.md`, `STORYBOARD.md`, compositions, audio, renders)
- Create (repo, this task): nothing yet — the chapter is Task 12; this task produces the artifacts.

**The film (from the spec):** public promo for HyperFrames itself ("write HTML, render video"), ~45-60s, 7 frames, 1920×1080. Required technique checklist and its frame mapping:

| Frame | Content                                                                                                                             | Techniques it must carry                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| F1    | Hook — kinetic type on the one-line pitch                                                                                           | L2 skeleton, L3 grammar (staggered overshoot entrances) |
| F2    | "Write HTML" — a composition types itself                                                                                           | L4 code-blocks (per-character typing beat)              |
| F3    | "It becomes video" — pipeline diagram; **matched-motion transition into F4** (a diagram line becomes the F4 chart axis)             | L3 transitions                                          |
| F4    | Proof — data-viz beat (e.g. render-speed or catalog count-up)                                                                       | L4 data-and-maps                                        |
| F5    | Generated-artwork hybrid — one illustration-led beat (generated raster on contrasting solid bg, keyed, code-layer animation on top) | L4 generated-artwork                                    |
| F6    | Capability montage — quick cuts, continuous camera push across them                                                                 | L3 camera-as-actor, L1 callbacks to workflows           |
| F7    | Landing lockup — F1 motif returns denser (callback), the film's one breather, CTA `npx skills add heygen-com/hyperframes`           | L6 storyboard craft                                     |

Production constraints:

- `frame.md`: strict two-color system + negative list, per the internal-promo pattern — but pick a palette that is NOT cream/cobalt (do not read as a reuse of the internal films).
- `STORYBOARD.md` uses the same frontmatter + per-frame field shape as `videos/team-vault-explained/STORYBOARD.md` (format/message/arc/audience/music; per-frame scene/voiceover/duration/transition_in/type/persuasion/beat/blueprint/focal). VO-paced reveals throughout.
- Narration: TTS via `/media-use` (pick a voice explicitly — pass `--voice`); BGM resolved via `/media-use` at the default bed level (post-#2110 `bgmDefaultVolume`, do not override).
- Variables: expose the two palette colors + product name as composition variables; render twice — default, and one `--variables` re-skin.
- The film is built BY a builder subagent from a single long-form prompt (the "capstone prompt") that the guide will print in full — this is the point: the prompt IS the most advanced artifact. Author the capstone prompt first (brief + design system + storyboard direction + technique requirements in prose, per the guide's own anatomy), then run the Validation Protocol with name `capstone`. Iterate the prompt (fresh builder each time) until the render passes review; the shipped chapter prints the exact prompt that produced the shipped render.

- [ ] **Step 1: Author the capstone prompt** (long-form; follows the guide's own 6-part anatomy; encodes the table above without naming levels)
- [ ] **Step 2: Run the Validation Protocol, name `capstone`** — builder must produce: `frame.md`, `STORYBOARD.md`, frames, passing `lint`/`check`, `capstone.mp4`
- [ ] **Step 3: Re-skin render** — `npx hyperframes render` with `--variables` overriding the palette colors → `capstone-reskin.mp4`
- [ ] **Step 4: Review gate** — watch both renders; check every row of the technique table is visibly present; if not, revise the prompt and re-run Step 2 with a fresh builder
- [ ] **Step 5: Upload** — copy `capstone.mp4` + `capstone-reskin.mp4` to `docs/images/prompting/`, run `bash scripts/upload-docs-images.sh`, `curl -sI` both URLs → 200

No repo commit in this task (artifacts live outside the repo + on S3).

---

### Task 12: Capstone chapter + overview rewrite

**Files:**

- Create: `docs/prompting/capstone.mdx`
- Modify: `docs/prompting/overview.mdx` (full rewrite), `docs/docs.json` (add `"Level 7 — Capstone"` group with `["prompting/capstone"]` between Level 6 and Appendix), `docs/prompting/remotion-migration.mdx` (exit bridge → capstone)

**Editorial contract — `capstone.mdx`:**

1. Opens with the embedded `capstone.mp4` render, then: "every technique in this film has a chapter in this guide."
2. Prints the full capstone prompt verbatim (the one that produced the render), then dissects it: walk brief → design system → storyboard → frames → validation → render, each step linking the chapter that taught it (anatomy, visual-specs, motion, transitions, code-blocks, data-and-maps, generated-artwork, media-and-audio, design-systems, variables-and-templating, storyboards, rendering-and-output).
3. Shows the `capstone-reskin.mp4` pair with the exact `--variables` invocation used.
4. Exit bridge points at the Appendix cheat sheet: "keep this open while you build."

**Editorial contract — `overview.mdx`:**

1. Rewrite as the arc's map: open with the capstone embed and the promise "by the end of this guide you can build this with a prompt"; then the level ladder (one line per level: what you can do after it); then the existing one-time skill setup; then the two prompt shapes + workflow loop condensed.
2. Existing "best of" example embeds may stay at the bottom.

- [ ] **Step 1: Write `capstone.mdx` per the contract**
- [ ] **Step 2: Rewrite `overview.mdx` per the contract**
- [ ] **Step 3: Nav + bridges, format + docs sanity gate**
- [ ] **Step 4: Commit**

```bash
/usr/bin/git add docs/prompting/capstone.mdx docs/prompting/overview.mdx docs/prompting/remotion-migration.mdx docs/docs.json
/usr/bin/git commit -m "docs(prompting): capstone chapter + overview rewritten as the arc's map"
```

---

### Task 13: Final QA + PR update

**Files:**

- Modify: PR #2109 description (via `gh`), spec `plans/prompt-guide-arc.md` status line.

- [ ] **Step 1: Full-guide QA sweep**

```bash
cd ~/src/wt/hyperframes/prompt-guide
bun run format:check                    # expect exit 0
python3 -c "import json; json.load(open('docs/docs.json')); print('ok')"
cd docs && npx mintlify broken-links    # expect none
# every S3 embed resolves:
grep -rhoE 'https://static\.heygen\.ai/[^" ]+\.mp4' docs/prompting/ | sort -u | while read u; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -I "$u"); [ "$code" = 200 ] || echo "BROKEN $code $u"
done
```

Also start `npx mintlify dev --port 3333` in `docs/` and click through the level nav once.

- [ ] **Step 2: Bridge-chain check** — read only entry/exit bridges of all chapters in nav order; every exit target matches the next chapter; fix any mismatch.

- [ ] **Step 3: Update spec status** — change `plans/prompt-guide-arc.md` line 3 `Status:` to `implemented <today's date>`; commit with the bridge fixes if any:

```bash
/usr/bin/git add -A plans/prompt-guide-arc.md docs/
/usr/bin/git commit -m "docs(prompting): final QA pass for the guide arc"
```

- [ ] **Step 4: Push + update PR #2109**

```bash
/usr/bin/git push origin fix/prompt-guide-validation-bugs
gh pr edit 2109 --title "docs: Prompt Guide as a novice-to-capstone arc + text corrections from validation"
```

Rewrite the PR body (via `gh pr edit 2109 --body-file`) to describe: the arc restructure (levels, full dissolve, bridges), the capstone film + its validated prompt, new topics covered (proxies, new lint rules, changelog-video, structure mandate, variables/CSS fix), the new validation builds, and keep the existing "text corrections" section. Keep the existing footer convention.

- [ ] **Step 5: Verify CI green**

```bash
gh pr checks 2109 --watch
```

Expected: Format passes (Task 1); docs-only lanes skip as before.
