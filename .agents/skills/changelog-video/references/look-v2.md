# Look v2: what the site's launch film teaches (frame by frame)

Source: the HyperFrames Studio launch film, the hero video on hyperframes.studio
(`https://static.heygen.ai/hyperframes-oss/site/studio-launch-nib-sf-audio.mp4`, 80.8 s, 1920x1080, 30 fps),
measured shot by shot. `examples/v2/` is the weekly video built to these rules.

## Look

| Thing             | Value                                                                                                                           | Where it shows up in the film                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Ground            | paper `#f6f5f1` / off-white `#f2f1ee`                                                                                           | mascot shots, timeline, use-case prompts                              |
| Stage for the app | mint `#3ce6ac` to teal to blue gradient, coming up from the bottom of the frame                                                 | Studio preview at 24-33 s                                             |
| Ink               | `#131109`                                                                                                                       | all type on light grounds, dark pills                                 |
| Accent            | mint `#3ce6ac`, **once per frame**                                                                                              | Framey, the selection box, "humans" turned mint, the active tool pill |
| Dark UI           | `#0d0d0f` cards with a hairline border, white type                                                                              | "Start something new" prompt box, preview                             |
| Type              | TT Norms Pro: bold (700, -0.05em) paired with light (300; `assets/fonts/TT_Norms_Pro_Light.woff2`); product UI at real UI sizes |                                                                       |
| Texture           | halftone / CMYK dots                                                                                                            | card reveal, background of the generated video, dot burst transition  |
| Logo              | official lockup, untouched, only on the end card, with a soft spotlight vignette                                                | 77-81 s                                                               |

## Motion grammar (the rules we copied)

1. **The thing you click becomes the next shot.** Send button zoom-through (button scales ~8% to 250% in 0.35 s,
   `power3.in`), Export pill becomes a ball, a dragged card becomes a timeline clip. No arbitrary wipes.
2. **Real product UI, staged.** The app is rebuilt and decluttered, never a raw screen recording, and the camera is
   rarely on the whole app: it cycles between the app as a floating card (~75% width), one pane filling the frame,
   and a hard punch-in to one control (text about 5% of frame height).
3. **Punch-in hard cuts for edit beats.** Cut to a 3x tighter frame on the control, act, cut back wide, and the
   change lands with a ~0.1 s blur pulse.
4. **Text lands and stays put.** Titles don't drift; emphasis comes from cuts and punch-ins, not wobbling text.
   About 7 words maximum as display type.
5. **Cursors act.** A human macOS arrow presses Send / Export with a visible press; Framey (green, one eye, no wings)
   is the agent's pointer and drags things.
6. **About 6 hard cuts in 80 s; everything else is a designed move** (whip with motion blur, push-in, pull-out).
7. **Logo held back to the end card**, wiped in, never parked in a corner.

## What this changes in the weekly video

| Old weekly video                                                                 | v2                                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Dark green ground, the same layout in every scene (headline plus one small card) | Paper ground; the Studio window on the mint→blue stage; a different framing per scene                                |
| UI text at 10-14 px, unreadable on a phone                                       | Headlines 64-72 px, UI labels 24 px or more                                                                          |
| Placeholder shapes (white balls)                                                 | The film's own UI: prompt box, Studio preview, inspector, timeline, terminal                                         |
| Scenes cross-fade                                                                | Object-motivated hand-offs: send-button zoom-through, version chip becomes the window, halftone burst, punch-in cuts |
| Word-by-word caption rail                                                        | Headlines carry the meaning (works muted in Slack, X and Discord autoplay); the voiceover adds detail                |
| Corner chrome "HYPERFRAMES WEEKLY" on every frame                                | Logo only on the end card                                                                                            |
