# Review

You wrote the timeline, so you know what happens; the viewer sees it once, at full speed, often on a phone. Review is how you see the film as they will: as a harsh motion director, not a proud author. `check` catches what is broken; this pass catches what is weak. Run it after `check` passes, on every new film and on any edit that changes timing or layout, before you reply or render.

## 1. Measure, then look

1. `npx hyperframes check --json`. Besides errors it warns on craft it can measure: a line on screen too briefly to read (`line_unread`), more than 3 s with nothing changing (`dead_stretch`), text under 2.6% of the frame's short side (`text_below_floor`), an empty first frame (`first_frame_empty`, the thumbnail on social players), a film over 15 s with no sound (`film_silent`). A warning is a question, not a rule: fix it, or keep it on purpose and say why in the note (a deliberate hold carries `data-hold`).
2. `npx hyperframes snapshot --review` writes three sheets: each scene just after it starts and at its middle, plus each `data-beat`, a strip across every cut (−0.2 s to +0.2 s), and the beat frames at phone width (360 px). Open all three.
3. Motion between the beats: `snapshot --range START,END --frames 8` around the hero move and the payoff; `keyframes --shot` for a path that must arc or land.
4. The rendered file: `npx hyperframes audio <video> --json` shows whether sound is there, where it hits and how loud it is. You cannot hear it; say so.

Trust the numbers over your eye where they disagree: a clipped label or a 0.6 s line looks fine on a contact sheet.

## 2. What to look for

First, describe each beat frame in one sentence as a stranger would, naming every object; an object you would have to explain ("those bars are mirrors") is a P0. Then read the beat frames in order: do they tell a story a stranger follows, each one causing the next? Compare each with its shot in `SPEC.md`; what does not match is a note. Then name every default the frames show (`spec.md` "BANNED by default", or one not on the list yet), add each to the BANNED line, and fix them before anything else.

Then go through the sheets once per question:

| Question                      | What it catches                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does it read as what it is?   | A shape that reads as another object, a material that reads as plastic, a product screen that reads as a mockup, a face or mascot that reads wrong |
| Does the subject separate?    | Subject and ground too close in value, two focal points in one frame, the eye with nowhere to go                                                   |
| Framing and contact           | Crops, text at the edge or under platform UI, collisions at a seam, things floating that should touch                                              |
| Timing as a first-time viewer | A read shorter than its words (`story.md` §6), something that pops on with no move, a jump at a cut, everything moving at once on one curve        |
| Tells                         | Which items of `story.md` §8 and `motion.md` "Defaults that look generated" are on screen                                                          |
| The pictures alone            | With the words covered, do the beat frames still tell the storyline?                                                                               |
| The phone sheet               | Can every line meant to be read be read at 360 px?                                                                                                 |

## 3. Notes and fixes

Write each problem as one line: `t=4.2s · where · problem → exact change · what stays`. Rank them:

- **P0** breaks the read or the contract: unreadable, wrong, broken, a tell in the hero shot.
- **P1** weakens the film: a dead stretch, a soft payoff, a seam that jumps.
- **P2** polish.

Fix every P0 and the P1s worth their time: text first, then timing, then detail. Then snapshot only what you changed, once. A second pass only when a P0 is still open. Never score the film out of 10: a score finds nothing to fix. When a fix does not hold, snapshot the frames on either side of the problem, list every difference, and change only the line that causes it. A film that feels busy: remove a third of the motion and keep the moves that lead the eye.

A fresh pair of eyes, when your host can start a sub-agent: give it only `STORYBOARD.md` and the three sheets, ask for P0 and P1 lines in the format above, and keep editing to yourself. Commit or copy the project before you fix, so a fix that makes things worse can be rolled back.

## 4. The delivery note

Write `REVIEW.md` at the project root and put its short form in your reply:

- the creative calls you made, and the storylines you did not build;
- what you measured and what you only looked at; what nobody checked (the sound was measured, not heard);
- the weakest shot, and what you would change with more time;
- warnings you kept on purpose, and why.

The next turn reads it before changing anything.
