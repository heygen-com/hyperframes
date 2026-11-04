# Cards over talking-head footage

Designed cards, lower thirds and split layouts over a person speaking. Placement numbers are for 1920×1080 and 1080×1920; scale others.

## Where the video sits

| Layout                       | Landscape (x, y, w×h) | Portrait (x, y, w×h) |
| ---------------------------- | --------------------- | -------------------- |
| Split, video beside the card | 960, 0, 960×1080      | 0, 960, 1080×960     |
| Stack, video above           | 14, 14, 1892×548      | 0, 0, 1080×844       |
| Overlay                      | full frame            | full frame           |

Picture-in-picture, 28 px from the edges (bottom-right: y = H − h − 28):

| Canvas    | Source | Rectangle         |
| --------- | ------ | ----------------- |
| Landscape | 16:9   | 1432, 28, 460×258 |
| Landscape | 9:16   | 1644, 28, 248×440 |
| Portrait  | 16:9   | 690, 28, 360×203  |
| Portrait  | 9:16   | 738, 28, 312×555  |

- Card zones: a lower third is the bottom 30%; a side panel the right 42% (landscape) or bottom 40% (portrait). Glass card slots: 48, 460, 660×540 landscape; 24, 1280, 1032×564 portrait.
- Portrait type is landscape × 1.3 (titles × 1.35, stats × 1.4); padding drops from 40–64 px to 24–36 px.
- Size a rectangle to its source's aspect: `object-fit: cover` crops a portrait source in a landscape box.

## Timing

- Cards fade in over 0.4 s (`power2.out`) and out over 0.35 s (`power2.in`). Re-frame the video (0.5–0.7 s) only in a gap between cards; move it with transforms on a wrapper, not `left`/`top`/`width`/`height`.
- A static card goes dead after about 8 s; past about 15 s it needs a staged reveal. As a starting density: one card per 6–8 s under a minute, 8–12 s up to 3 min, 12–20 s up to 10 min.
- A transcript's last word can end past the media: clamp card ends and the root `data-duration` to the file's ffprobe length, or the render ends in black.

## Pitfalls

- Lower-third, overlay and picture-in-picture scenes need a transparent root, or they hide the speaker.
- Glass over bright footage goes white on white: put a dark scrim behind it (about `rgba(0,0,0,.55)` fading out from the top, `.72` at the bottom) and a dark glass base such as `rgba(15,16,22,.78)` with `backdrop-filter: blur(22px)`.
- More than 3 timed elements on one track warns `timeline_track_too_dense`: give each chapter its own sub-composition.
- Footage with keyframes more than about 1 s apart freezes on seek: re-encode with `-g <fps>`.

Text behind the speaker (a caption between the footage and a cutout of the person): `captions.md`.
