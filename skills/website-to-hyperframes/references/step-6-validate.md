# Step 6: Validate & Deliver

This is the quality gate. Before the user sees anything, YOU verify that the video matches the storyboard, the creative direction from Step 2, and DESIGN.md. Deliver something you'd be proud to post with your name on it.

## Definition of Done — required before ANY preview or summary

**You may not say the video is ready, looks good, or present a preview URL until every item below is checked.** No exceptions. Do not summarize your impressions — paste the actual evidence for each.

Score each item 1–5. If any item scores below 3, fix it before continuing.

```
[ ] Lint: zero errors                     → paste the lint output (not "lint passed")
[ ] Snapshot taken, N frames confirmed    → state the exact frame count
[ ] descriptions.md read in full          → quote the WORST frame Gemini described
[ ] Contact sheet viewed                  → describe the weakest-looking beat in one sentence
[ ] No mid-video dark frames              → state explicitly which frames (if any) are dark and why
[ ] Audio duration matches video ±0.5s    → paste both numbers
[ ] Critic sub-agent run                  → paste its single biggest quality gap finding
```

**Why this matters:** The natural tendency is to look at a contact sheet, see that content is present, and declare it done. That is not verification — that is pattern-matching to a completion signal. Verification means running each check and reporting the raw result. "Frame 7 at 14.2s shows the logo in the top-left against a dark blue background, text is centered" is evidence. "The video looks great" is not.

---

## Lint + Validate + Snapshot

The `hyperframes` skill (which you loaded in Step 5) already covers the mechanics of linting, validating, and snapshotting. Follow those rules — run lint, validate, take snapshots scaled to the video length (formula: `max(beats × 3, ceil(duration_seconds / 2))`). Fix errors. This step adds the **pipeline-specific verification** on top of that.

**Errors:** Fix ALL of them. These are real problems — missing timeline registration, broken scripts, missing assets.

**Warnings:** Read each one and decide. Some are real quality issues you must fix:

- **GSAP tween overlaps** — elements fighting over the same property = visual glitches
- **Unscoped selectors** — will target elements in ALL compositions when bundled, causing data loss
- **Missing `class="clip"`** — element visible for entire video instead of its scheduled time
- **Missing `data-start` on root** — playback won't begin

Some are style suggestions you can safely ignore:

- **File too large** — composition works fine, just harder to read
- **Deprecated attributes** (data-layer, data-end) — still work, just not preferred
- **Dense tracks** — informational, not a bug

Don't blindly ignore 158 warnings. Don't blindly fix all of them either. Read them.

## Visual Verification (snapshot)

After lint and validate pass, capture snapshot frames to SEE your own output. **Take many snapshots — as much as you can actually read and view all of them without hitting diminishing returns**. This is your only visual feedback before the user sees the project. You wanna be honored and proud of what you give to the user.

Scale snapshot count to the video — not a fixed number. Formula: `max(beats × 3, ceil(duration_seconds / 2))`. A 3-beat 10s video: max(9, 5) = 9 frames. An 8-beat 60s video: max(24, 30) = 30 frames. Aim for at least 3 frames per beat: entrance, hold, and near-exit.

**⚠ NEVER use `npx hyperframes snapshot`.** The published CLI (0.6.6) is missing critical fixes: sub-comps load before capturing, local-time seek for last beats, Gemini vision descriptions. Always use the local CLI below or all beats after the first may appear black and descriptions.md won't be generated.

```bash
# IMPORTANT: .env values are NOT automatically inherited by CLI subprocesses.
# Always export GEMINI_API_KEY explicitly or Gemini descriptions won't run:
export GEMINI_API_KEY=$(grep GEMINI_API_KEY .env | cut -d= -f2)
npx tsx packages/cli/src/cli.ts snapshot <project-dir> --frames <N>

# Pass a custom question to Gemini instead of the default prompt:
export GEMINI_API_KEY=$(grep GEMINI_API_KEY .env | cut -d= -f2)
npx tsx packages/cli/src/cli.ts snapshot <project-dir> --frames <N> \
  --describe "Is the brand logo visible in every beat? Is any beat showing a black or blank frame?"
```

Output lands in `<project-dir>/snapshots/`. Gemini writes `snapshots/descriptions.md` automatically.

**If `descriptions.md` is missing or empty after the snapshot:** `GEMINI_API_KEY` was not set. Re-export and re-run. Do not proceed without Gemini descriptions — visual inspection alone is not sufficient verification.

**Gemini descriptions will flag two frames as "blank/black" — these two are expected and not bugs:**

- `frame-00-at-0.0s.png` — always dark, animations haven't started
- The last frame of the video — always dark, the s-end dummy scene is intentionally invisible

Every other frame described as "black," "blank," "no visible content," or "loading screen" in the middle of the video IS a bug. Investigate and fix it.

**Two required reads — both, not one. Then a per-beat verdict.**

1. **Read `snapshots/descriptions.md`** — Gemini's objective written analysis of every frame. Read every line. Do not skim.

2. **View `snapshots/contact-sheet.jpg`** — the full grid. Look at every cell.

After reading both, write a per-beat verdict for every beat:

```
Beat 1 (0.0s–4.5s): [what Gemini described] | [what contact sheet shows] | PASS / NEEDS FIX
Beat 2 (4.0s–9.5s): ...
Beat 3 ...
CTA beat: ...
```

A beat PASSES only if:

- Gemini description matches what STORYBOARD.md says should be happening
- Contact sheet shows visible content (not black, not blank, not loading)
- Brand colors/fonts visible
- No elements clipped or mispositioned

A beat that "has some content" does not automatically pass. Compare against what was _planned_, not just "something is there."

**If any beat fails: fix it, re-snapshot, re-read descriptions.md, re-write the per-beat verdict from scratch.** Do not carry forward old verdicts after a fix — re-evaluate everything because fixes can break adjacent beats.

**Keep iterating until every beat passes.** There is no time limit. A video with one black CTA beat is not done.

## Critic Sub-Agent — do not skip

**This is not optional. Run it after your per-beat verdicts all pass — before you start preview.**

Spawn a sub-agent with this exact prompt:

```
You are a senior motion designer and creative director reviewing a brand video before it ships. You have high standards and have seen hundreds of these.

Read these files:
- STORYBOARD.md (what was planned)
- DESIGN.md (brand rules)
- snapshots/descriptions.md (what Gemini sees in each frame)
- snapshots/contact-sheet.jpg (view it)

Score each dimension 1–5. Be specific — name the beat and timestamp for every problem you identify.

1. **Beat execution** (1–5): Does every beat deliver what STORYBOARD.md planned? Name any beat that underdelivers and what exactly is wrong.
2. **Brand accuracy** (1–5): Does this feel made for THIS brand specifically, or could it be for any company? Name one element that is distinctly on-brand and one that is generic.
3. **Visual quality** (1–5): Any blank frames, clipped text, centering failures, invisible elements? Cite exact frame timestamps.
4. **Motion design** (1–5): Do animations feel intentional and polished, or default and mechanical? Name the weakest transition and why.
5. **CTA beat** (1–5): Is the final beat clear, centered, readable, and does it hold long enough? Describe exactly what is visible on the CTA frame.

End with: What is the single most important fix before this ships? Name the beat, the element, and the specific change.

If you cannot find any problems and want to score everything 4–5, you are not looking hard enough. Look again.
```

Read every score. Fix anything below 3 before showing the user. If the CTA scores below 3, fix the CTA. Do not rationalize low scores as "the user can decide."

## Preview (always do this)

Always start the preview so the user can see and scrub through the project:

```bash
npx hyperframes preview
```

The Studio URL is the deliverable. In your final response, always include it:

```text
http://localhost:<port>/#project/<project-name>
```

Use the actual port and project name from the preview command output. Do NOT present `index.html` as the project link — that's the source file. The user-facing project is the running Studio preview.

## Render (on-demand only)

**Do NOT render automatically.** Preview is the delivery — the user scrubs, spots tweaks, and you iterate. Rendering takes minutes per pass and is wasted if the user wants changes.

Only render when the user **explicitly asks** — "render it", "make the final", "export the MP4", "I'm happy, produce the file."

When rendering, **always specify quality and resolution explicitly.** Don't use defaults silently — pick the right settings for the use case and tell the user what you're rendering:

```bash
# Standard quality, 1080p landscape (default for most videos)
npx hyperframes render --output renders/<name>.mp4 --quality standard --fps 30

# High quality for final delivery
npx hyperframes render --output renders/<name>.mp4 --quality high --fps 30

# Portrait for Instagram Stories / TikTok
npx hyperframes render --output renders/<name>.mp4 --quality standard --fps 30 --resolution portrait

# 4K for premium output
npx hyperframes render --output renders/<name>.mp4 --quality high --fps 30 --resolution 4k
```

**Available options:**

| Flag              | Values                                                                                     | Notes                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `--quality`       | `draft`, `standard`, `high`                                                                | draft = fast/low, standard = balanced, high = slow/best                            |
| `--fps`           | `24`, `30`, `60`                                                                           | 30 is standard, 24 for cinematic feel, 60 for smooth motion                        |
| `--resolution`    | `landscape` (1920×1080), `portrait` (1080×1920), `landscape-4k` (3840×2160), `portrait-4k` | Aliases: `1080p`, `4k`, `uhd`                                                      |
| `--format`        | `mp4`, `webm`, `mov`, `png-sequence`                                                       | mp4 default. mov/webm for transparency. png-sequence for AE/Nuke                   |
| `--output`        | path                                                                                       | Always set to `renders/<project-name>.mp4` for readable names                      |
| `--gpu`           | flag                                                                                       | Use GPU encoding if available (faster)                                             |
| `--crf`           | integer                                                                                    | Override encoder quality (lower = better, mutually exclusive with --video-bitrate) |
| `--video-bitrate` | e.g. `10M`                                                                                 | Target bitrate (mutually exclusive with --crf)                                     |

Tell the user what you're rendering and why: "Rendering at standard quality, 1080p landscape, 30fps — this gives good quality with reasonable render time. Want me to use high quality or 4K instead?"
