# Step 6: Validate & Deliver

This is the quality gate. Before the user sees anything, YOU verify that the video matches the storyboard, the creative direction from Step 2, and DESIGN.md. Deliver something you'd be proud to post with your name on it.

## Definition of Done — required before ANY preview or summary

**You may not say the video is ready, looks good, or present a preview URL until every item below is checked.** No exceptions. Do not summarize your impressions — paste the actual evidence for each.

Score each item 1–5. If any item scores below 3, fix it before continuing. **Do not rush these.** Each checkbox is its own pass through the artifacts — slow down, look at every frame, write the actual observation, not a summary impression.

```
[ ] Every beat HTML read top-to-bottom    → see "Per-beat file read" below; paste the per-beat verdict
[ ] Lint: zero errors                     → paste the lint output (not "lint passed")
[ ] Snapshot taken, N frames confirmed    → state the exact frame count
[ ] descriptions.md read in full          → quote the WORST frame Gemini described, verbatim
[ ] Contact sheet viewed cell-by-cell     → for EACH beat, one sentence: what's in frame, what's moving, what brand assets are present
[ ] No mid-video dark frames              → state explicitly which frames (if any) are dark and why
[ ] Brand assets actually visible         → for each beat, name which captured SVG / illustration / screenshot is on screen and at what timestamp. If a beat shows zero captured assets, justify why.
[ ] Audio duration matches video ±0.5s    → paste both numbers
[ ] animation-map.json generated          → run `node <repo-root>/skills/hyperframes/scripts/animation-map.mjs <project-dir>`; confirm every beat has events listed and no bbox/flag warnings
[ ] w2h-verify report                     → run `node <repo-root>/skills/website-to-video/scripts/w2h-verify.mjs <project-dir>`; paste the FULL output (every row, every percent) verbatim into your final user-facing summary — see "w2h-verify — the source of truth" below
[ ] Audio + motion verification done      → see "Audio + motion verification" below; played the full preview, confirmed SFX lands at storyboard timestamps
[ ] Critic sub-agent run                  → paste its single biggest quality gap finding, verbatim
```

### w2h-verify — the source of truth

The skill ran for months on agents reading "REQUIRED" and skipping anyway. The verify script ends that — it computes facts the agent cannot fudge:

- **Required artifacts present** (STORYBOARD.md, DESIGN.md, SCRIPT.md, index.html)
- **Brand visuals used** — at least 1 beat must reference a captured `hero-*`, `image-*`, or `svgs/*.svg` asset (logo doesn't count). Catches the "9% asset usage / brand isn't visually present" failure.
- **Headline font-size** — per-beat, the largest CSS `font-size` must be ≥80px. Catches the "headlines too small to read" failure that surfaces later as inspect `clipped_text` errors.
- **Timeline coverage** — per-beat, GSAP event positions must span ≥70% of the beat's `data-duration`. Catches "webpage not shot" failures where the beat has entrance tweens then goes static.
- **Shader transitions consistency** — shaders declared in STORYBOARD.md must appear in index.html (with HyperShader runtime present, not just as SFX file references).
- **SFX timestamp drift** — storyboard `t=X.Xs` vs index.html `data-start=X.X`, picks the closest index timestamp per file for multi-timestamp SFX.
- **Beat duration consistency** — storyboard's beat ranges (`B4 — Name | 16.600 – 21.000s |`) must match `data-duration` in index.html within ±0.5s. Catches storyboard staleness.
- **Rendered MP4 existence** — INFO only; flagged when claiming verified motion without rendering.

Run it as the LAST gate in your DoD pass, after fixing everything else:

```bash
node <repo-root>/skills/website-to-video/scripts/w2h-verify.mjs <project-dir>
```

(Locate the repo root from a project subdirectory: `find "$HOME" -path '*/skills/website-to-video/scripts/w2h-verify.mjs' -maxdepth 10 2>/dev/null | head -1`.)

**The script's output is the deliverable.** Paste the entire report — the table, the percentages, the FAIL lines — verbatim into your final user-facing summary, in the "What I verified" / "What I did NOT verify" section. The user will read it directly. You don't get to summarize, simplify, or omit rows.

**If any row says FAIL:**

- Either fix the underlying issue and re-run until the row says PASS
- Or include the FAIL row verbatim in your final summary's "What I did NOT verify" section with a one-sentence explanation of why you chose not to fix it

**Forbidden:**

- Hand-writing your own verification summary that doesn't match the script's output
- Cherry-picking which rows to include
- Replacing percentages with adjectives ("most assets used" instead of "8%")
- Running the script, seeing FAIL, and not mentioning it

The script's exit code is 0 (all pass) or 1 (one or more fail). If you ship with exit=1, the user knows from the report exactly what they're getting.

### Per-beat file read

This is what verification means now: you open each `compositions/beat-N.html` and read it top-to-bottom against DESIGN.md and STORYBOARD.md. Step 5 already required this once before advancing here — repeat it here as the final check, in case fixes during Step 5 introduced new problems.

For each beat, write a per-beat verdict in this form:

```
Beat N (Ns–Ns) — <name>
  CSS bg: <hex> (DESIGN.md says <hex>, matches: yes/no)
  CSS accent: <hex> (DESIGN.md says <hex>, matches: yes/no)
  Headline font-size: <px> (≥80: yes/no)
  Captured assets referenced: <list of paths from <img>, inline SVG, background-image> (storyboard called for: <list>)
  GSAP timeline coverage: events from <first t> to <last t>, beat duration <N>s (full coverage: yes/no)
  Storyboard alignment: <one sentence — does this beat deliver what its STORYBOARD.md section described>
  VERDICT: PASS / NEEDS FIX (<what specifically>)
```

The pre-fix-era flow took longer specifically because it caught these problems. Don't trade the careful look for a green checkmark.

**Why this matters:** The natural tendency is to look at a contact sheet, see that content is present, and declare it done. That is not verification — that is pattern-matching to a completion signal. Verification means opening every file the sub-agents produced, reading every line, and reporting the raw result. "Frame 7 at 14.2s shows the Raycast logo SVG drawing its final stroke at 0.85 opacity against #07080A, the headline 'Crush your sprint' has settled in 96px Inter SemiBold below" is evidence. "The video looks great" is not.

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

**WCAG contrast warnings — per-warning verification, not blanket dismissal.**

The validator samples text colors at fixed timestamps. Elements at `opacity: 0` (pre-entrance) or mid-fade get measured as if fully visible — real false positives exist. BUT this is a per-warning judgment, not a blanket excuse.

**For EACH warning the validator emits, paste this block in your verdict:**

```
Warning N: <quote the validator output verbatim>
  Element: <selector>
  Sampled timestamp: t=<n>
  At t=<n>, is this element on-screen at full opacity? (yes/no — confirm by viewing snapshot at that timestamp)
  Verdict: REAL ISSUE / SAMPLING ARTIFACT (justify in one sentence)
  Action: <hex change at line N>  OR  NONE because <reason>
```

**Forbidden:** writing "the N warnings are mostly transition-window false positives" without per-warning evidence. That phrasing alone fails the gate. The validator does not report 158 warnings as a group — it reports them individually, and you verify them individually.

Don't blindly ignore. Don't blindly fix. Verify each.

## Visual Verification (snapshot)

After lint and validate pass, capture snapshot frames to SEE your own output. **Take many snapshots — as much as you can actually read and view all of them without hitting diminishing returns**. This is your only visual feedback before the user sees the project. You wanna be honored and proud of what you give to the user.

Scale snapshot count to the video — not a fixed number. Formula: `max(beats × 3, ceil(duration_seconds / 2))`. A 3-beat 10s video: max(9, 5) = 9 frames. An 8-beat 60s video: max(24, 30) = 30 frames. Aim for at least 3 frames per beat: entrance, hold, and near-exit.

```bash
# The CLI auto-loads .env from the current working directory, so a
# .env file in <project-dir> with GEMINI_API_KEY=... is enough — no
# explicit `export` needed. If you've set GEMINI_API_KEY in your shell
# environment, that works too.
npx hyperframes snapshot <project-dir> --frames <N>

# Pass a custom question to Gemini instead of the default prompt:
npx hyperframes snapshot <project-dir> --frames <N> \
  --describe "Is the brand logo visible in every beat? Is any beat showing a black or blank frame?"
```

Output lands in `<project-dir>/snapshots/`. Gemini writes `snapshots/descriptions.md` automatically.

**If `descriptions.md` is missing or empty after the snapshot:** `GEMINI_API_KEY` was not set — confirm it's in `<project-dir>/.env` (the CLI loads .env from CWD) or in your shell environment. Re-run after fixing.

**Fallback if Gemini is genuinely unavailable** (no key, key invalid, or quota exhausted): use your own image-reading capability to inspect each frame in `snapshots/` directly. For each frame, write one sentence describing what's on screen — focus on the dimensions Gemini would catch (blank/dark frames, missing brand assets, text legibility, layout problems). Save these descriptions as `snapshots/descriptions.md` yourself so the rest of the checklist still has a single source of truth. State explicitly in your verdict that descriptions were agent-authored, not Gemini-authored, so the user knows to spot-check.

**Gemini descriptions will flag two frames as "blank/black" — these two are expected and not bugs:**

- `frame-00-at-0.0s.png` — always dark, animations haven't started
- The last frame of the video — always dark, the s-end dummy scene is intentionally invisible

Every other frame described as "black," "blank," "no visible content," or "loading screen" in the middle of the video IS a bug. Investigate and fix it.

**Two required reads — both, not one. Then a per-beat verdict.**

1. **Read `snapshots/descriptions.md`** — Gemini's objective written analysis of every frame. Read every line. Do not skim.

2. **View `snapshots/contact-sheet.jpg` cell-by-cell.** Not a glance. Look at every cell, name what's in it. Past agents have reported "contact sheet looks good" after a single scan and missed: a beat that was visually black for 80% of its duration, a logo placed off-screen, a headline clipped at the canvas edge, captions running off the bottom. The contact sheet is the only place these failures are visible together. **For each cell, write one sentence: what's in frame, what's moving, which brand assets are present, anything that looks wrong.** If you find yourself wanting to summarize the contact sheet as a whole, stop and go back to cell-by-cell.

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
3. **Captured asset utilization** (1–5): The user captured the brand's actual SVG logos, hero illustrations, and screenshots into `capture/assets/`. Are they on screen in this video, or did the agents recreate everything from divs and CSS? List which captured assets appear in which beats. If beats are missing them, flag it — a video that recreates everything in CSS is generic, not branded.
4. **Visual quality** (1–5): Any blank frames, clipped text, centering failures, invisible elements? Cite exact frame timestamps.
5. **Motion design** (1–5): Do animations feel intentional and polished, or default and mechanical? Name the weakest transition and why.
6. **CTA beat** (1–5): Is the final beat clear, centered, readable, and does it hold long enough? Describe exactly what is visible on the CTA frame.

End with: What is the single most important fix before this ships? Name the beat, the element, and the specific change.

If you cannot find any problems and want to score everything 4–5, you are not looking hard enough. Look again.
```

Read every score. Fix anything below 3 before showing the user. If the CTA scores below 3, fix the CTA. Do not rationalize low scores as "the user can decide."

## Audio + motion verification — three paths, pick one

Snapshots are silent stills. 18 PNG snapshots from a 30s 30fps video = 18/900 = 2% of frames. The other 98% — including all motion, all transitions, all audio — is unverified by snapshots alone. "Confirmed via snapshot" is not coverage.

You MUST do ONE of these three paths before declaring done:

### Path 1 (preferred): Play the preview

Open the Studio URL in a browser via Playwright (or another browser tool you have). Play start-to-end at 1.0× speed (NOT scrubbed). Confirm:

```
[ ] Played full video front-to-back at 1.0× — actually played, not scrubbed
[ ] For each SFX in STORYBOARD.md: sound lands at the visual moment within ±0.1s
    (Beat N SFX `<file>`: storyboard says t=<x>s → heard at t=<y>s → drift <z>s)
[ ] Narration delivers the right line per beat (no off-by-one or missing lines)
[ ] No moments where audio is present but visual is mid-transition unintentionally
[ ] Audio audible and not clipped/peaked
```

### Path 2: Render a low-res MP4 and read it frame-by-frame

When Playwright isn't available, render at 540p (fast — ~30s for a 30s video) and read the MP4:

```bash
node /<repo-root>/packages/cli/dist/cli.js render <project-dir> \
  --width 960 --height 540 --quality medium
```

Then sample the resulting MP4 at minimum 5fps (use `ffmpeg -i <mp4> -r 5 frames/frame-%04d.png` if needed). Read those frames sequentially. For each SFX moment in STORYBOARD.md, find the corresponding frame and confirm the visual matches.

### Path 3 (last resort): Explicit deferred disclosure with quantified gap

If neither Path 1 nor Path 2 is possible in this session, your final summary MUST contain this verbatim:

```
**Audio + motion verification: NOT POSSIBLE in this session.**
- Snapshots cover: <N> frames out of <video_duration × fps> total (<percentage>% coverage)
- NOT verified: motion between snapshots, SFX/visual timing alignment, shader transition smoothness, audio mix levels, narration sync to beats
- Recommended user action: open the preview URL above and play start-to-end; flag anything that feels off
```

**Forbidden everywhere:**

- "Confirmed via snapshot" or "snapshots look right" as audio/motion evidence
- "Preview is running, looks good" without actually playing it
- Path 3 disclosure that omits the quantified coverage gap (the percentage is mandatory)

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

### Honest disclosure — REQUIRED in your final summary

Your final message to the user MUST end with these two sections, even if everything passed. Both sections appear AFTER the preview URL, BEFORE you stop talking.

```
**What I verified:**
- <one bullet per DoD item that passed, with the actual evidence cited inline>
  (e.g. "Lint: zero errors — output pasted above")
  (e.g. "Per-beat read: 7/7 beats PASS, evidence blocks above")
  (e.g. "WCAG: 3 warnings flagged, all 3 verified as sampling artifacts — see verdicts above")

**What I did NOT verify (spot-check these):**
- <one bullet per item you skipped, deferred, or could not complete — and why>
  (e.g. "Audio + motion verification deferred — no Playwright in this session. SFX timing is computed but unconfirmed in playback.")
  (e.g. "animation-map.json skipped — script not found at expected path; manually confirmed timeline coverage in per-beat reads instead.")
  (e.g. "Beat 5 has a 0.4s window where the doc card is visible but contents are still opacity 0 — sub-agent flagged it, I chose not to fix because it was below my threshold; worth your eye.")
```

The user reads this section to know what to spot-check.

**UNACCEPTABLE final summaries:**

- "Looks great, ready to ship" (no disclosure)
- "All checks pass" (when one was actually skipped)
- "Sub-agents confirmed everything" (delegating trust without verifying)
- Omitting the "What I did NOT verify" section because you happened to verify everything (still include it — write "None" if true, but the section header must appear).

Lying or omitting here is worse than skipping a check honestly. A short user spot-check beats a hidden broken video every time.

## Render (on-demand only)

**Do NOT render automatically.** Preview is the delivery — the user scrubs, spots tweaks, and you iterate. Rendering takes minutes per pass and is wasted if the user wants changes.

Only render when the user **explicitly asks** — "render it", "make the final", "export the MP4", "I'm happy, produce the file."

When rendering, **always specify quality and resolution explicitly.** Don't use defaults silently — pick the right settings for the use case and tell the user what you're rendering:

```bash
# Standard quality, 1080p landscape (default for most videos)
npx hyperframes render --skill=website-to-video --output renders/<name>.mp4 --quality standard --fps 30

# High quality for final delivery
npx hyperframes render --skill=website-to-video --output renders/<name>.mp4 --quality high --fps 30

# Portrait for Instagram Stories / TikTok
npx hyperframes render --skill=website-to-video --output renders/<name>.mp4 --quality standard --fps 30 --resolution portrait

# 4K for premium output
npx hyperframes render --skill=website-to-video --output renders/<name>.mp4 --quality high --fps 30 --resolution 4k
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
