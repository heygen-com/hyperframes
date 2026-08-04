# example.com — 10-second product intro

The HyperFrames docs **Reference Project**. One real project, built end to end from one
real request:

> Using `/hyperframes`, make a 10-second product intro for `https://example.com`.

**1920×1080 · 10.000s · 30 fps · 300 frames · one scene · one caption overlay.**

Everything in here is real: the plate is a live capture of `example.com`, the copy is
the page's own wording, the narration is synthesised speech, and the caption timings are
measured word timings from that narration. Nothing is mocked, and no command output in
these files is invented.

---

## Run it

```bash
bun run dev      # Studio preview (long-running — keep it in the background)
bun run check    # lint + runtime + layout + motion + contrast, one command
bun run render   # → renders/video.mp4
```

The scripts pin an exact CLI version so this project re-renders identically over time.
To move the pin up: `npx hyperframes@latest upgrade --project . --check`, then drop
`--check` to apply, then re-run `bun run check`.

## Files

| File                         | What it is                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `index.html`                 | the composition — root timeline, the whole scene, all four audio tracks           |
| `compositions/captions.html` | the caption overlay, wired as a sub-composition on track 2                        |
| `BRIEF.md`                   | the confirmed intent the workflow was handed                                      |
| `frame.md`                   | the design spec — palette, type, the plate rule, the caption skin                 |
| `STORYBOARD.md`              | the plan: `## Video direction` plus one time-coded shot sequence                  |
| `SCRIPT.md`                  | locked narration, the voice, and the exact commands that regenerate it            |
| `VERIFICATION.md`            | what passed, what changed from v1, and the two framework bugs found on the way    |
| `transcript.json`            | Whisper word timings for `assets/narration.wav` — the source of every caption cue |

## The five variables

Declared on `<html>` as `data-composition-variables`, so the same composition can front
another site without touching the HTML:

| id               | type   | default                                                         |
| ---------------- | ------ | --------------------------------------------------------------- |
| `title`          | string | `Example Domain`                                                |
| `accent`         | color  | `#334488`                                                       |
| `supportingLine` | string | `For use in documentation examples without needing permission.` |
| `siteUrl`        | string | `example.com`                                                   |
| `pageImage`      | string | `assets/example-com.png`                                        |

They are wired **declaratively** — no `getVariables()` call anywhere in this project:

```html
<h1 data-var-text="title">Example Domain</h1>
<!-- text substitution -->
<img data-var-src="pageImage" src="assets/example-com.png" />
<!-- src substitution -->
```

```css
background: var(--accent, #334488); /* the runtime publishes every scalar variable
                                      as a --<id> custom property on the root */
```

Override at render time:

```bash
npx hyperframes render --variables '{"title":"Acme Docs","accent":"#0f766e"}'
npx hyperframes render --variables-file rows.json --strict-variables
```

Two gotchas worth knowing, both learned here:

1. **Keep the `data-composition-variables` JSON pure ASCII.** It sits on `<html>`, which
   is consumed before `<meta charset>` takes effect, so a literal em dash in a `default`
   renders as `â€"`. Use the JSON escape `\u2014` instead — verified by snapshot. Body text
   and sub-composition text are unaffected.
2. **Put `data-var-src` before `src`.** `lint`'s `missing_local_asset` scan matches the
   last `src=` in the tag, and `data-var-src` also ends in `src`, so the reverse order
   makes it read the variable id as a filename and fail.

## Audio

Four tracks, each a plain `<audio>` element — the framework owns playback, so this
project never calls `play()`, `pause()` or seeks.

| Track | Element       | Asset            | Baseline | Notes                                      |
| ----- | ------------- | ---------------- | -------- | ------------------------------------------ |
| 8     | `#bgm`        | `bgm.wav`        | `0.34`   | ducked / recovered / faded on the timeline |
| 9     | `#vo`         | `narration.wav`  | `1.0`    | starts at `1.00s`, runs `6.97s`            |
| 10    | `#sfx-plate`  | `sfx-whoosh.mp3` | `0.20`   | at `2.62s`, under the plate's travel       |
| 11    | `#sfx-marker` | `sfx-tick.mp3`   | `0.16`   | at `4.54s`, on the marker draw             |

<!-- The two WAVs are the only assets over the repository's 500 KB non-LFS
     limit, so they are the only ones stored as pointers. -->

Both WAVs are Git LFS pointers, so **run `git lfs pull` before rendering**. Without
it the bed and the voiceover are 130-byte stubs and the captions — timed from
`narration.wav` — play over silence. The two MP3 stings and the capture PNG are
stored plainly and need no extra step.

The bed is not a static level. Volume is **keyframed on the timeline**, which the runtime
probes and applies identically in preview and render:

```js
tl.to("#bgm", { volume: 0.13, duration: 0.6 }, 0.7); // duck under the voice
tl.to("#bgm", { volume: 0.3, duration: 0.9 }, 7.7); // recover after the last word
tl.to("#bgm", { volume: 0, duration: 1.0 }, 9.0); // out under the end card
```

`data-volume` is only the baseline for elements no tween touches.

## Captions

`compositions/captions.html`, mounted on track 2 for the full 10s. It follows the
captions overlay doctrine literally, and the discipline is worth copying:

- **Three groups for three spoken sentences.** Phrase-level, not word-level churn.
- **Fixed position, always.** One full-width absolute container, `text-align: center`,
  `bottom: 64px`. No `left: 50% + translateX(-50%)` (it clips at canvas edges), no
  per-group placement, no random offsets.
- **A structurally reserved band.** `index.html`'s stage ends at `bottom: var(--band)`
  (`184px` = 17%), so nothing in the artwork can ever collide with a caption. Verified
  with `check --caption-zone "x0=0;y0=.83;x1=1;y1=1;severity=error;…"`.
- **One group visible at a time, provably.** Group _n_'s hard kill sits at the exact time
  group _n+1_ starts, so before that instant only _n_ can be non-zero and after it _n_ is
  killed outright.
- **Emphasis by luminance only.** Each word lights `#9a9a9a → #ffffff` on its own
  measured onset and stays lit, so the phrase fills in with the voice. No scale pop, no
  colour flash, no scatter exit, no marker effects, no labels.
- **`fitTextFontSize` as the overflow guard**, so an edited or translated phrase shrinks
  instead of wrapping up out of the band.

## Media provenance

The project keeps only the assets used by the composition:

| Shipped asset            | Source                                                      |
| ------------------------ | ----------------------------------------------------------- |
| `assets/example-com.png` | `npx hyperframes capture https://example.com`               |
| `assets/narration.wav`   | ElevenLabs **River**, `eleven_multilingual_v2`              |
| `assets/bgm.wav`         | HeyGen audio catalog, 10.0-second bed                       |
| `assets/sfx-whoosh.mp3`  | `/media-use` bundled library — `whoosh-short`, 0.57 seconds |
| `assets/sfx-tick.mp3`    | `/media-use` bundled library — `click-soft`, 0.37 seconds   |

Generated capture folders, frame dumps, contact sheets, and compiled docs embeds are not
committed. The docs copy of the verified render is served from the HyperFrames media CDN.

## Learning path through the composition

Read `index.html` top to bottom; it is ordered deliberately:

1. `data-composition-variables` on `<html>` — the parameters.
2. `#root` custom properties — the palette, and the `--band` reservation.
3. Track 0 `#bg` — why a full-bleed fill rides on a clip layer and never on `#root`.
4. Track 1 `#stage` — a two-column flex stage that stops above the caption band.
5. `.page` — `object-fit: none` + `object-position`, the 1:1 plate rule.
6. Track 2 — the sub-composition host, and the three ids that must match exactly.
7. The `<audio>` elements — one per track, `<video>`-free, framework-owned.
8. The timeline — load states first, then one tween per narration cue, with the two
   deliberate holds left visibly empty.
