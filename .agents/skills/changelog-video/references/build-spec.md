# Build Spec — square 1080 changelog master

Single-doc `index.html`: scenes are absolutely-positioned `.slide` clips on
track 1; the master timeline `tl` (MUST be named `tl` — seam-stamp emits
`tl.*`) is paused, padded to total duration, registered as
`window.__timelines["main"]`. See `examples/master-skeleton.html` for the
verbatim scaffold.

## Brand tokens (HeyGen for Developers)

```css
@font-face {
  font-family: "ABC Solar Display";
  font-weight: 700;
  src: url(assets/fonts/ABCSolarDisplay-Bold.woff2) format("woff2");
}
@font-face {
  font-family: "TT Norms Pro";
  font-weight: 400;
  src: url(assets/fonts/TT_Norms_Pro_Normal.woff2) format("woff2");
}
@font-face {
  font-family: "TT Norms Pro";
  font-weight: 500;
  src: url(assets/fonts/TT_Norms_Pro_Medium.woff2) format("woff2");
}
@font-face {
  font-family: "TT Norms Pro";
  font-weight: 700;
  src: url(assets/fonts/TT_Norms_Pro_Bold.woff2) format("woff2");
}
@font-face {
  font-family: "TT Norms Mono";
  font-weight: 400;
  src: url(assets/fonts/tt_norms_pro_mono_regular-webfont.woff2) format("woff2");
}
/* ink #f5f6f4 · ink2 rgba(245,246,244,.72) · dim rgba(245,246,244,.66) —
   NOT .45: the contrast gate fails small text under 4.5:1 over the glass.
   green #5ef17c (RATIONED: one moment per scene) · bg #0a0c0b ·
   chip-bg rgba(10,12,11,.78) · glass-line rgba(190,255,205,.32) */
```

Copy fonts from `<SKILL_DIR>/assets/fonts/` into the project's
`assets/fonts/` (local @font-face with format('woff2') embeds at render).
Glass card: chip-bg fill, 1px glass-line border, radius 22,
`box-shadow: 0 24px 60px rgba(0,0,0,.5)`. NO backdrop-filter. Chips: mono
18-22px, radius 12, 1px rgba(255,255,255,.14) border on rgba(255,255,255,.05).
Display type: ABC Solar Display 700. Body: TT Norms Pro. Everything
code/UI-label: TT Norms Mono. Safe margins x/y ∈ [76, 1004].

## Animated background (the house pattern)

Encode the bundled source to the film's exact duration — the render
compiler shortens a video's slot to the media length, so the encode must be
≥ total:

```bash
ffmpeg -y -stream_loop 15 -i <SKILL_DIR>/assets/bg-pattern.mp4 -t <TOTAL> \
  -vf "scale=1080:1080,fps=30,eq=saturation=0.72,drawbox=c=black@0.5:t=fill" \
  -an -c:v libx264 -crf 20 -pix_fmt yuv420p assets/bg-pattern-<TOTAL>s.mp4
```

Keep the darkening crush — the raw pattern is far too loud. Mount as
`<video id="bg-video" class="clip" muted>` on track 0 + a static
`rgba(8,10,9,.25)` scrim div. `<video>` needs the id (silent/black
otherwise) and must stay flat 2D (no 3D ancestors).

## Scene anatomy

- Chrome (untimed, z 6): kicker chip top-left `HYPERFRAMES WEEKLY · <RANGE>`,
  progress dots top-right (one per theme; `tl.set` backgroundColor at each
  cut — active #f5f6f4, done .45; never tl.call for state).
- Title (≤2s): mono kicker date, ABC Solar h1 ~104px, green rule sweep.
- Theme scene: sec-chip `0N · THEME NAME` (top 128) + ABC Solar headline
  ~54px (top 186) + the mock (from the visualization registry) filling
  y ∈ [288, 944].
- Outro (≤3.5s): kicker FULL DIGEST, "See what shipped." ~96px, green rule,
  mono URL chip, tag line. Fade all + chrome ~0.5s before end.
- Caption rail per `script-voice.md` (top: 990, font-size: 32px, height: 52). Mandatory — populate the master-skeleton's `LINES` array from `captions.json` before render; see SKILL.md step 5.

## Seams + internal life (doctrine mechanics)

- `ledger.json`: every ordinary seam `cut-the-curve LEFT` (x, dir −1), exit
  and entry selectors = the slide wrappers. Outro entry `travel: 8`.
- `seam-stamp.mjs --ledger ledger.json --write index.html` owns ALL wrapper
  entries/exits — author none yourself. Title (film open) authors its own
  entry only.
- Slides: CSS `opacity: 0` base; `data-start` = exactly the cut time.
- Each scene's shell (chip, headline, mock chrome, initial state) is
  COMPOSED at local t=0 — the wrapper flies it in. Internal reveals start
  ≥0.4s after the cut and end ≥0.45s before the next cut (stamped exits
  begin at cut −0.34s).
- Every internal beat lands on a VO word from `vo-words.json`. Name each
  scene's sustained-motion route in the plan (sequenced UI life for mocks,
  staged reveals for checklists). One green moment per scene.
- Init states via `gsap.set(...)` at build time; animation via sequential
  `tl.to(...)` only (no plain-object keyframes, no repeat:-1, no tweening
  left/top — set base position in CSS, tween x/y). Counters: object tween
  with an `onUpdate` in the tween config (cache DOM refs; never
  `tl.eventCallback`).

## Lint/check gotchas (all hit before, all pre-solved)

- Mock containers with intentional stacking: `data-layout-allow-overlap` on
  the slide root; elements a playhead/line crosses:
  `data-layout-allow-occlusion`.
- Dim text: `rgba(245,246,244,.66)` minimum (contrast gate).
- Audio: every `<audio>` carries an `id`. BGM: the house track ships at
  `<SKILL_DIR>/assets/bgm.mp3` (159s instrumental) — copy it to the project
  as `bgm.mp3` and mount on its own track:
  `<audio id="bgm" src="bgm.mp3" data-start="0" data-duration="<TOTAL>" data-track-index="2" data-volume="0.14" data-media-start="0">`
  (0.14 sits under the VO; use a user-supplied track only when given one).
- Preview server caches the bundle — RESTART after edits, then verify on the
  raw comp page (`/api/projects/<id>/preview/comp/index.html`) via
  `window.__player.seek(t)`.
