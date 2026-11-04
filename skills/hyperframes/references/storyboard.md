# Storyboard recipe — plan a video as stills the person approves

Use it whenever a run makes or changes a storyboard: when the person asks for one, or when you want their go on the shots before animating. This file owns **how to make the board**; `storyboard-format.md` owns the `STORYBOARD.md` file the tools parse.

A film's shots are planned in the SHOTS line of `SPEC.md` (`spec.md`); a storyboard turns those shots into stills when the person wants to approve them first, one frame per shot, carrying its `reads` and `sound` (`storyboard-format.md`).

The person sees the plan as stills on the board, comments or draws on a frame, and says go. The board is `boards/storyboard.html`, and tools that show it find its frames by the classes in § 2; boxes marked any other way (`cell` boxes, `id="frame-NN"` markers) are not found.

## 1. The run

1. **Pose each shot** in the composition the project renders, the root `index.html`, at its key moment: real words, real fonts, real colors, the focal point big enough to read on a phone. A shot posed in its own file (`compositions/frames/NN-*.html`) shows only once it is mounted in `index.html` (`data-composition-src`) at its planned start; `snapshot` renders `index.html` and nothing else. Before the first pose, copy `index.html` to `boards/.film.html`: until the go, the preview plays that film, never the stills (step 4).
2. **Snapshot every still in one run** with your host's snapshot tool when one is offered (each shot's seconds, out `boards/stills`); otherwise `npx hyperframes snapshot --at <every shot's seconds, in film order> --no-end --describe false -o boards/stills`. Each still is named `frame-NN-at-<seconds>s.png`, NN its place in the film. Every `snapshot` run clears its `-o` folder and numbers from `00`, so never snapshot a single moment into `boards/stills/` itself (step 5). Look at every still yourself; fix and snapshot again until each one holds.
3. **Write `boards/storyboard.html`** (§ 2), styled as a finished board: Inter or the system sans-serif, a light page, each frame a rounded card with its still above its words, even gaps.
4. **Put the film back.** Copy the posed `index.html` to `boards/.posed.html`, then `boards/.film.html` back over `index.html`. The board stays on its own page: held stills in the preview read as a slideshow.
5. **Stop.** Hand the person the board and wait for their go. Notes on frames change only those frames. For each one: copy `boards/.posed.html` over `index.html`, re-pose it, snapshot just its moment into `boards/stills/redo/` (`--at <its seconds>`), move that one file over the frame's old still under the old name (its new time in the name if the time changed, and the page's `src` with it), then put the film back (step 4), rewrite the page and stop again. The other stills stay as approved.
6. **Once they say go**, copy `boards/.posed.html` over `index.html` and animate from the approved stills.

## 2. The page

One `class="frame"` box per still, in film order, holding its image, a `class="title"` line "<two-digit number>: <name>" and a `class="time"` range in seconds. Optional: a `class="words"` line under it, and a `class="act"` heading before the first frame of each act.

```html
<section class="act">Act 1: The hook</section>
<div class="frame">
  <img src="stills/frame-00-at-1.5s.png" alt="" />
  <div class="title">01: The hook</div>
  <div class="time">0.0 to 3.0s</div>
  <p class="words">The cursor drops the photo on the timeline; the title lands on the drop.</p>
</div>
```

Stills are written next to the page (`boards/stills/`), so `src` is relative to `boards/` and names the file `snapshot` wrote for that shot. A still written after the page shows by itself; never reopen or rename the page for it.

## 3. The plan beside it

`STORYBOARD.md` at the project root (format: `storyboard-format.md`) names the same frames in the same order, and its words win over the page's: one heading per frame like `## Frame 1: The hook (0-3s)`, a `- act:` bullet for its act, and `- status: outline` until its still is posed.
