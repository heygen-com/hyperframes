---
name: changelog-video
description: Turn a weekly changelog .md into a finished branded changelog video (square 1080, ~45-60s, Annie VO, animated brand background, mock-UI visualizations, lowkey captions). Use when the user provides a changelog/digest markdown and wants the weekly video, or says "changelog video". Self-contained — fonts, background, lexicon, and scripts ship in this skill.
---

# Changelog → Branded Video

Input: a changelog .md (themes + items, like the weekly HyperFrames digest).
Output: a lint-clean, seam-gate-green HyperFrames project in
`projects/active/weekly-changelog-<range>/`. Render only when asked.

**Load first, non-negotiable:** `motion-doctrine` (+ `cut-the-curve`,
`oversized-cursor` if a cursor appears, `seam-craft`) and `captions-overlay`.
This skill supplies the changelog-specific pipeline; the doctrine supplies the
motion law.

## The prime directive: visualize, don't list

Every theme is illustrated by an **animated mock of the actual UI or a
faithful analog** acting out the change in experience — never text bullets.
Route every theme/item through `references/visualization-registry.md` BEFORE
writing the script; the registry decides ui-recreate / ui-analog / terminal /
checklist. Text checklist is the LAST resort, reserved for genuinely
non-visual items (reliability fix lists).

## Pipeline

### 1 · Parse + editorial cut

- Extract: week range, headline stats (releases, commits), themes, items.
- **Budget: 45-60s total.** Title ≤2s, outro ≤3.5s, 4 themes ≈ 9-12s each.
- Per theme keep ONE hero visualization + at most 3 spoken items. Everything
  else exists only as the outro's "full digest" pointer. Cutting is the job:
  a changelog with 30 items still yields ≤14 spoken beats.
- Order themes by story: marquee feature → product surface → performance →
  reliability (the digest usually already reads this way).

### 2 · Visualization routing

For each theme, pick the surface from `references/visualization-registry.md`
and write one line: `theme → surface → the 2-4 sequenced actions the mock
performs, each tied to a script phrase`. If no registry surface fits and no
faithful analog exists, it's a checklist scene — don't invent fake UI for
something we can't represent honestly.

### 3 · Two-layer script (spoken vs display)

Write the script as **token lines** per `references/script-voice.md`:
conversational register, every technical term carrying a `spoken` phonetic
form from `references/lexicon.json` while `display` keeps standard spelling.
Captions show `display`; the VO reads `spoken`. Any term not in the lexicon:
STOP and ask the user how it's pronounced, then add it to the lexicon.
Save as `script-tokens.json` in the project.

### 4 · VO — Annie (HeyGen, pinned)

```bash
# spoken-layer text only; words JSON = ground-truth timestamps of the SPOKEN text
# Repo-native path: the changelog-video skill runs from the hyperframes repo root,
# so it uses the tracked hyperframes-media TTS helper directly (no `npx hyperframes
# skills` install step). If you've copied the skill into another repo, swap in
# your own path to the media-use / hyperframes-media heygen-tts.mjs.
node skills/hyperframes-media/scripts/heygen-tts.mjs ./vo-spoken.txt \
  -o voiceover.mp3 --words vo-words.json \
  --voice 330290724a1b470fb63153f34d4c0183   # Annie — lifelike (do not substitute)
```

Requires `heygen` CLI ≥0.3.0 authenticated (`heygen auth login --oauth`).
Then align spoken timestamps back to display tokens:

```bash
node <SKILL_DIR>/scripts/align-captions.mjs \
  --tokens script-tokens.json --words vo-words.json --out captions.json
```

`captions.json` is the caption-rail input (display spelling, spoken timing).
The aligner prints `MISMATCH` warnings — resolve every one before building
(usually a lexicon spelling the TTS renders as multiple words). **The audio
is the clock**: all beat times come from `vo-words.json`; a VO regen re-opens
every seam.

### 5 · Build

Follow `references/build-spec.md` exactly: brand tokens + fonts (bundled in
`<SKILL_DIR>/assets/`), the animated background encode, scene scaffold,
chrome, caption rail, one rationed green moment per scene. Then the doctrine
order: `ledger.json` (all ordinary seams cut-the-curve LEFT) → seam-stamp →
internal beats on VO words → seam-gate verify.

### 6 · Gates (all green before presenting)

1. `bun run --cwd packages/cli hyperframes check` (or the installed
   `hyperframes` CLI from the repo-local `skills/hyperframes-cli/` skill) —
   0 errors (contrast: dim text ≥ .66 alpha). Do NOT reach for
   `npx hyperframes@latest`; the tracked repo-local CLI is the source of
   truth for the composition contract this skill produces against.
2. `seam-gate.mjs verify` — 0 fail.
3. Restart the preview server (it caches the bundle), spot-check 3-4 beats
   via `__player.seek` on the raw comp page.
4. Do NOT render unless the user asks. After a requested render, verify
   frames from the MP4 (`ffmpeg -ss <t> … -frames:v 1`): captions present,
   background video not black, no tiny/frozen frames.

## Project layout

```
projects/active/weekly-changelog-<range>/
├── index.html            # single-doc master (scenes as slides, stamped seams)
├── ledger.json           # vector ledger (seam-stamp input)
├── script-tokens.json    # two-layer script (source of truth for VO + captions)
├── vo-spoken.txt         # generated: spoken layer, one line
├── voiceover.mp3 + vo-words.json + captions.json
├── bgm.mp3               # copy from <SKILL_DIR>/assets/bgm.mp3 (the house track) unless the user supplies one
└── assets/fonts/ + assets/bg-pattern-<dur>s.mp4
```

## Anti-patterns

| Don't                                    | Instead                                        |
| ---------------------------------------- | ---------------------------------------------- |
| Bullet-point slides for UI changes       | Mock the surface acting out the change         |
| Fake UI for un-representable items       | Honest checklist scene                         |
| Plain "JSON"/"CLI" in the TTS text       | Lexicon spoken forms; display stays standard   |
| Phonetic spellings in captions           | Captions always render the display layer       |
| Guessing an unknown term's pronunciation | Ask, then grow the lexicon                     |
| Speaking every changelog item            | ≤3 per theme; the digest link carries the rest |
| Green accents everywhere                 | One green moment per scene (#5ef17c)           |
