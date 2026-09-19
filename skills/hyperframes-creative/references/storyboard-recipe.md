# Storyboard recipe — plan a video like the launch films

Applies wherever a run plans on a storyboard (`storyboard: yes` in `brief-contract.md`). This file owns **how to make the storyboard**: what goes in it, and the one HTML page the user reviews. `review-loop.md` owns when the user is asked; `storyboard-format.md` owns the `STORYBOARD.md` file the scripts parse; `story-spine.md` owns the order of the story. The method is distilled from the shipped launch films' storyboards (a header, a named spine, a beat list, a contact sheet, a review round) and from how their handoffs describe them. Nothing here is a Studio feature: the agent writes the storyboard, the user reads it in chat and in a browser.

## 1. Open with the decisions, before any beat

Message, audience, arc and format go in the `STORYBOARD.md` frontmatter (`storyboard-format.md`); the rest go in sections above the first `## Frame` heading. Frame packets take everything after a frame heading to the next one, so a section placed after the last frame leaks into that frame's packet. Repeat the first three in the chat proposal:

- **Message**: one sentence, written as a claim, not a topic ("Close isn't final", not "About the inspector").
- **Audience and arc**: who watches, and the arc named in one line (pain → turn → proof → logo, or the workflow's own archetype).
- **Format**: aspect, target length, voiceover yes/no, music yes/no. Caption keep-out (content in the top ~83% when captions run).
- **The spine**: the one device that threads every beat, named now, not discovered while building (a persistent window, a silent button that finally has sound, one background that leads every transition).
- **Brand, from a capture**: palette by role with hex, three type roles (display, sans, mono) with sizes, radii and easings, each token noting where it came from. Take them from the real site or product, never from memory; `frame.md` holds them.
- **Bans**: a short per-video "do not" list (no glow, no side-by-side explainer layouts, no fake product UI, no static endcard). Name two motion failures to avoid: the slideshow (every beat a fresh card) and the screensaver (motion that says nothing).
- **Held frame**: allocate one beat on purpose where nothing moves and the line lands.

## 2. The beat list

One beat per idea, one focus per beat. Give each beat a short semantic name that will also be its composition filename.

| Field       | Rule                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Heading     | `NN — Name (start–end, ~dur)`, absolute times. Sum the durations and state the total; check it against the target length by arithmetic. |
| Beat length | 1.5–3.5 s. A beat that must be read gets ~3 s; a beat that only hands off gets 1.5–2 s; a line of 5–7 words gets 2–2.5 s.               |
| On screen   | What is visible, in concrete terms (the object, its count, its position), with every on-screen word verbatim in quotes.                 |
| Voiceover   | Verbatim, or `onscreen` for silent films. Reveals land on the word or beat cue that names them.                                         |
| Hero prop   | The object that persists, and the beat where it returns (callback). A callback beat states which earlier beat it answers.               |
| Motion      | Named moves with easing and duration, from a small vocabulary. First visible motion within 0.2 s of the beat starting.                  |
| Seam out    | The named transition into the next beat and its direction. One direction rule for the whole film (leftward is the default).             |
| Audio cue   | Sound effect or music cue with its time, when the film has sound.                                                                       |
| Constraint  | At least one explicit "no …" per beat that could go generic.                                                                            |
| Why         | The beat's job in the story, traced to the message. A beat whose why cannot be traced is cut.                                           |

Real product proof is real: a captured screen, the real command output, or a labelled placeholder beat that holds the slot. Never draw a vendor's UI in DOM. Where the film depicts something real, add a truthfulness line saying what is real.

Craft devices that make a storyboard specific (hero prop, accumulation, breather, callback, two-color discipline) are taught with examples in `docs/prompting/storyboards.mdx`; use them by name.

## 3. `storyboard.html`: the page the user reviews

Write one self-contained HTML file in the project root, `storyboard.html`, from `STORYBOARD.md`. Tell the user the path and to open it in a browser. It is the review surface, and it must be beautiful enough to judge the film from.

- **Header**: title with a version (`v1`), one-line dek, and a tag with resolution, length and beat count.
- **Grid**: three columns of 16:9 cells (`aspect-ratio: 16 / 9`, `container-type: inline-size`, sizes in `cqw` so the sheet matches the build), chronological, grouped under an act bar when there are acts.
- **Each cell** carries `id="frame-NN"` (the build reads its layout from there) and shows the beat's key moment drawn with the real words in the real fonts and brand colors, plain shapes for panels, charts and media, one accent on the focal. Then a label row (`NN · NAME` left, `id · start–end` right), a note that says what moves first and which way the seam goes (bold lead-in, one or two sentences), and a small chip naming the seam.
- **Two closing cells**: a seam map (every seam on one strip) and a tokens cell (palette, type roles, bans).
- **No motion, no scripts, no external assets.** Fonts are local `@font-face` or a system stack; images are inlined or relative. It must open from `file://`.

A sketch is a few dozen lines of HTML per cell; the whole sheet lands in minutes. Sketch fidelity is the point: a reviewer reacts to placement, hierarchy and copy, which is why the build later dresses the layout and never redraws it.

## 4. The review round

1. Present the chat proposal (`story-spine.md` § 3), then the sheet.
2. Record the user's notes verbatim under `## Changes from v1` and unresolved questions under `## Still open` (above the first frame), then bump the version and revise **only the beats named**.
3. Repeat until the user says the layout is locked, then list what is locked under `## Locked`. Build only after the lock.
4. When the build lands, the compositions are the truth: regenerate the timing table from `index.html` (and the transcript when there is voiceover) and update `STORYBOARD.md` and `storyboard.html` to match, because every launch film drifted from its storyboard. State the final length.

Do not render until asked.
