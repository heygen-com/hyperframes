# BRIEF: HyperFrames weekly changelog video v2 (Nov 2-9, 2026)

Reference build for the Nov 2-9, 2026 week (HyperFrames, 1080x1080, 30 fps; 40.5 s before the holds, 47.7 s after). Preview with
`npx hyperframes snapshot --at <film times> --no-end -o snaps/<name>`; gate with `npx hyperframes check --json`.
Read first: `references/look-v2.md` in this skill (what the site's launch film teaches), `index.html` (the shared kit CSS: `.k-paper`,
`.k-stage`, `.k-hl`, `.k-win`, `.k-bar`, `.k-dark`, `.k-chip(.mint|.ink)`, `.k-cursor`, fonts "TT Norms" 300/400/700 and
"TT Mono"), and the two finished scenes `compositions/hook.html` and `compositions/t1.html`. Copy their patterns exactly
(template wrapper, `#root`, one paused `tl` registered as `window.__timelines["<id>"]`, ids prefixed with the scene id,
`gsap.set` for initial states, no `Date.now`/random/timers). Globals available: `gsap`, `FrameyV4` (assets/framey-v4.js,
green Studio guide; API at the top of that file), `Prism` (assets/prism.js: `Prism.halftone(host, tl, {mode, at, dur,
cx, cy, color, pitch})`, `Prism.streaks`). NOTE `Prism.halftone` sizes its layer at 1920x1080: pass cx/cy in 1080 space and
override the created element's width/height to 1080px.

Reference frames from the site's launch film: `ref/frames/sheetA.jpg`, `ref/frames/sheetB.jpg`. Scene times below are
LOCAL (scene starts at 0). `work/cues.txt` has every voiceover word's local time per scene. The voice is already done;
land each visual beat on its word (a beat lands 0-2 frames after the word starts).

## Rules (non-negotiable)

- Paper ground `#f6f5f1` or the `.k-stage` mint→blue gradient. Ink `#131109`. Mint `#3ce6ac` once per frame. No dark full
  frames except UI cards. No pink/cyan.
- Headline: `.k-hl` with one bold run and one light run, ≤ 7 words, lands in 0.3 s (`power3.out`, y 18→0) and then
  stays still. UI text ≥ 22 px, so it reads on a phone. Content inside x 54-1026, y 54-1026.
- Real product UI, staged and decluttered (Studio window, inspector, timeline, terminal), never placeholder shapes.
- Every hand-off is motivated by an object or a camera move: punch-in hard cut on the control being acted on, whip with
  blur, halftone burst, the clicked thing becomes the next shot. Hard cuts are OK; slow cross-fades are not.
- Cursor presses are visible (scale 0.86 for 0.06 s). Framey (green, one eye) is the agent's pointer when an agent acts.
- Each scene must end on a frame the next scene can start from (t1 ends with a blur whip up off paper/stage; t2 starts on
  paper).
- Claims must match the digest exactly; don't add numbers.

## Scenes

### t2 Motion blur (local 0-5.60, paper ground). VO: "Motion blur now draws with the filter tier by default, and a new setting picks when the shutter opens."

Headline: **Motion blur** / _uses the filter tier by default._ (light) Claim source: the default `auto` tier now draws
with the filter tier; motion blur is still opt-in with `data-motion-blur="on"`; new `data-motion-blur-phase` sets when
the shutter opens in each frame. Show: a Studio preview card (dark) where a mint shape sweeps across with a visible
motion streak (draw the streak as 6-8 trailing ghost copies with falling opacity, deterministic), beside an inspector
panel with rows `data-motion-blur` = `on`, `tier` = `auto → filter` (highlight lands on "filter tier" ~1.7 s), then at
"a new setting" (3.36 s) a new row `data-motion-blur-phase` slides in with a slider; at "shutter opens" (4.47-4.9) the
slider handle moves and the streak shifts from trailing the shape to centred on it. Use one punch-in hard cut onto the
inspector row at ~3.3 s and cut back wide at ~4.3 s. End at 5.5 s ready for t3 (Studio).

### t3 Studio (local 0-5.70, `.k-stage` ground). VO: "In Studio, scrubbing stays sharp at full quality, and your agent's storyboard gets its own tab."

Headline: **Studio scrubs sharp.** / _Storyboards get a tab._ Claim source: Studio scrubs full-quality video with decoded
preview frames; a seek keeps a complete picture; when an agent writes a storyboard, Studio shows it in a Storyboard tab
beside the preview; step through frames with the arrow keys. Show: a Studio window (tabs "Preview" | "Storyboard" in its
top bar, a preview pane with a real-looking frame, a light timeline with 3-4 clips and a playhead, as in sheetB's
timeline). 1.0-2.6: Framey drags the playhead across the timeline; the preview stays sharp with a small "Full quality"
chip (optionally a 2-frame pixelated flash at the very start that resolves sharp, to show what used to happen). 3.4-3.9:
human cursor clicks the "Storyboard" tab (punch-in hard cut on the tab, press, cut back wide). 3.9-5.4: the preview is
replaced by a storyboard grid of 5-6 frames; a mint selection box steps frame to frame (arrow-key steps, show a small ←
→ key hint). End with a halftone dot burst out (mint/ink dots) from the selected frame at ~5.35 into t4.

### t4 Cloud renders (local 0-7.05, paper ground). VO: "Cloud renders pack your fonts, and big uploads go up in parts, so a dropped connection resends one part, not the whole file."

Headline: **Cloud renders** / _survive a dropped connection._ Claim source: `cloud render` packs the system fonts a project
uses into its upload; big files upload in parts, so a dropped connection resends one part instead of the whole file.
Start by resolving the halftone burst in (dots shrink away). Show: a dark terminal card `$ npx hyperframes cloud render`;
at "pack your fonts" (0.71-1.3) three font chips (Inter, Georgia, Menlo) fly into a "project.zip" chip and a line reads
"✓ 3 fonts packed"; at "big uploads go up in parts" (2.0-3.2) a file row "intro.mov · 1.2 GB" splits into 6 segments that
fill left to right; at "dropped connection" (4.04-4.6) segment 4 turns coral `#e5533d` with "connection dropped"; at
"resends one part" (4.85-5.8) only segment 4 refills; at "not the whole file" (6.08-6.7) all six are mint and the line
reads "✓ uploaded · resent 1 of 6 parts". End 6.9: hard cut is fine.

### t5 check (local 0-3.25, `.k-stage` or paper). VO: "And check replays an unchanged project in about a second."

Headline: **`check` in about a second.** (code in TT Mono). Claim source: `check` replays an unchanged project's last pass
in about a second. Show: a big dark terminal card, `$ npx hyperframes check` typed fast at 0.4-0.9; lines "project
unchanged since the last pass" (1.3), "replaying last pass" (1.6), then "✓ 0 errors" plus a timer counting 0.0 s → 1.0 s
(2.2-2.9) in mint. Use text large enough (≥ 30 px mono). End 3.15.

### outro (local 0-6.65, paper). VO: "That's the week. Full notes at hyperframes dot hey-jen dot com."

0-1.1: a quick typed list, centred, one line every ~0.25 s, then all blur out (the site film's use-case prompts at
44-49 s): "1440p render presets", "Catalog search", "`hyperframes update --check`", "Storyboard arrow keys", "Fonts in
cloud renders" (all real items from the digest). 1.2-6.65: the end card, as the site film's end card: the official logo
`assets/img/hf-logo-light.svg` (never re-typeset, never recolour; ~560 px wide) wiped in left to right in ~0.3 s at 1.25,
a warm soft spotlight vignette that closes in slightly, and under it a white pill "hyperframes.heygen.com/weekly-updates"
at 1.9 (the VO says the domain at 1.87-4.0) plus a small light line "Week of Nov 2-9 · v0.9.6 to v0.9.26". Hold still
from ~2.5 s to the end.

## Done means

`npx hyperframes check --json` has 0 errors for your scenes; you snapshotted your beats and looked at them; write a
3-line note per scene of what you built and anything you could not do. Do not touch `index.html`, `hook.html`, `t1.html`
or other agents' scenes. Do not render to MP4.
