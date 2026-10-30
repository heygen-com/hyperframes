# Films from a source: measured facts

What is specific to HyperFrames, or was measured on shipped films, when one video is made from a website, a script, a pull request, a music track, a real place or a short motion brief. The story comes first, from `story.md`; the shape of each kind of film is in `types/`. Motion craft is in `motion.md`, look in `look.md`, sound in `sound.md`, captions in `captions.md`.

## Script and pacing

- TTS reads about 2.2 words a second. Keep a scene to about 19 words (9 s); at most two scenes may reach 26 words (12 s). 30–90 s is about 155 words or fewer; a whole film about 400 at most.
- A voiceover longer than its visuals makes the visuals pad with idle drift. Trim the script; never stretch the motion.
- Everything on screen in the first quarter of a scene, then frozen, reads as a slideshow. Reveal each piece when the voiceover names it, across the back half of the scene; write the voiceover as separate phrases so it has cue points.
- Up to about six short scenes, build them yourself in one context (about 9 min for five, against about 21 min split across sub-agents). Beyond that, give each worker two or three scenes and start them all at once; a second wave nearly doubles the time.

## From a website

- `npx hyperframes capture <url> --json` writes `screenshots/full-page.png`: a 1x plate of the whole page, taken after the scroll pass with sticky and fixed elements made static, pixel-exact for a 1920-wide viewport travelling down it. It is skipped above 16384 px tall (use `scroll-*.png`); pushing in past 1:1 needs its own 2x capture of that region.
- To show the site as it is, use its screenshots. Rebuilding the page in HTML drifts from the real layout; rebuild only the part that moves, or overlay captured assets at measured positions.
- `--capture-budget` (default 120000 ms) bounds work after navigation; `--timeout` bounds navigation only. Videos are not downloaded: `capture --video <dir> --list`, then `--index N`. `asset-descriptions.md` has vision captions only when `OPENROUTER_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY` is set.
- "very little text content" with an empty asset catalog means the capture is unusable even when it says `ok: true`. A `logo-*.svg` name is a guess from page structure, not proof.
- Brand tokens: link blue `#0000EE` and status reds and greens are never the accent; the accent is the colour that recurs across the most roles. Icon fonts (Font Awesome, icomoon, webflow-icons) are never the display or body face; a captured monospace goes to the mono role. Use only weights the brand font ships, or 600/700 render as fake bold. Every preset has a light ground: for a dark brand, swap ground and ink.
- Capture keeps each `@font-face` rule, `unicode-range` subsets included, in `extracted/page.html`; copying the font files alone loses which characters each covers. Name copied fonts by family, weight and style, or an upright and an italic "Regular" collide.

## From a pull request

- `gh pr view --json files` stops at about 100 files: page `gh api repos/{owner}/{repo}/pulls/N/files`.
- The PR author only opened it: credit commit authors, by commit count (`commits[].authors[]`); skip bots, lockfiles and `dist/`. Reviewers come as logins; names via `gh api users/<login> --jq .name`. TTS reads `@handles` aloud, so speak names.
- Never invent a version. Use the first non-draft release published at or after the merge; else the default branch's `package.json` version as "unreleased"; else only the PR URL.
- Length from size (additions + deletions), as a ceiling: ≲50 lines 20–40 s, 50–200 40–70 s, 200–600 70–110 s, ≳600 lines or 25+ files 110–180 s.
- Show 2–4 hunks of 4–12 lines; counts like +N/−M go on a stat card, not into the voiceover.
- The `code-*` registry blocks (`npx hyperframes catalog --query code --json`) are 1920×1080 scenes driven by `window.__TOKENS` (Shiki tokens, `github-dark`; `fontStyle` bit 1 italic, bit 2 bold) and `window.__BLOCK` (`{id, effect, seq, line?, duration}`). `code-diff` and `code-morph` need at least two states; `code-highlight` counts lines from 0 and `code-scroll` from 1; `code-typing` types at a fixed speed, so check characters × speed against the scene's duration. They reserve no caption band: inset the panel when captions are on.

## On music

- Library music, HeyGen's included, comes as 15–30 s loops: loop the bed to the film with a 0.4 s fade-in and a 1.5 s fade-out. A track whose opening is a quiet build drains a short film: start from a stronger later section.
- Trust beat times only on rhythmic stretches; on calm music the tracker invents a metronome, often at double tempo (`npx hyperframes beats` reports `bpmConfidence`). Cut there on phrase and energy changes; `npx hyperframes audio --only sections,onsets,moments --json` finds them.
- A move that must land on a hit starts 40–190 ms early; a reaction starts 0–45 ms after. The hit itself is a 0 ms `tl.set`: easing a hit kills it. Scenes tile the track with no gaps.
- A word meant to be read holds at least one beat. Any single treatment goes stale after about 6 s: lengthen a section with a hold or a new treatment, never by slowing tweens. On rhythmic sections give footage one clip per strong beat; on calm ones one slow push from 1.0 to 1.08.

## Maps and real places

- A real place (a city, a building, a route, a zoom from the globe to a street) is shown on real imagery. Vector outlines from Natural Earth or GeoJSON read as a diagram and lose the place; keep them for borders and labels drawn on top.
- Live tiles change between renders, so bake the camera move to video with `scripts/bake-basemap.mjs` (MapLibre over Esri satellite or Carto tiles; writes an all-intra MP4 and `<NAME>-coords.json`). From space down to a street: `PROJECTION=globe FROM="lng,lat" CENTER="lng,lat" ZSTART=1.85 ZEND=16` (Earth in a starfield turns from FROM to CENTER, then dives); `--help` lists the rest. It needs network for the tiles and takes well under a second a frame, so bake once, keep the MP4, and run one bake at a time. Draw borders, pins and labels as a live SVG from those coordinates, animating them only while the camera holds.
- Credit the imagery on screen ("Esri, Maxar, Earthstar Geographics" or "© CARTO, © OpenStreetMap") in small type on a soft dark backing, so it holds contrast over bright tiles; mark it `data-layout-ignore` so the type floor in `check` skips it.

## Short motion pieces

- Kinetic type takes 3–7 English words or 4–12 Chinese characters per scene. A count-up runs 1.2–1.6 s, then holds, landing on a downbeat or a hard stop.
- A highlighter that wraps across lines: tween a custom property on a `background-size` band with `box-decoration-break: clone`. `getTotalLength()` can return 0 before layout; give line draw-ons a fallback.
- Hide a round-capped line with a gap longer than the path (`stroke-dasharray="100 120"`, `stroke-dashoffset="110"` on `pathLength="100"`), not dash = gap = offset: that leaves a dot at the end on some curves.
- A point in an image guessed directly misses by 16–24% of the frame. `scripts/locate.mjs` narrows it with a numbered 9×9 grid, then 6×6 on the crop, then a check render (about 2% error).
