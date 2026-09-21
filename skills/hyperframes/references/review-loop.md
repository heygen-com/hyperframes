# The review loop — plan, sketch, build

How a `storyboard: yes` run earns fidelity one pass at a time: the plan is reviewed as text in chat, the layouts as a sketched `storyboard.html` the user opens in a browser, and the finished piece as the assembled video. Collaborative mode waits at each checkpoint. Autonomous mode posts the same checkpoint summaries and continues, keeping exactly one question before render.

This is the shared process for any workflow that plans on a storyboard. The contracts it leans on live next door: interaction mode and gate types in `brief-contract.md`; the `STORYBOARD.md` format and the `outline → built → animated` statuses in `storyboard-format.md`. How to make the storyboard itself, and the page it is reviewed on, is `hyperframes-creative/references/storyboard-recipe.md`. A workflow's SKILL.md says **when** its steps hit each pass and supplies its **sketch stand-ins** (what the plain blocks represent); how the loop runs is defined here, once. The stage mechanics between the passes — audio, frames, assembly, transitions, captions, verify — live in `production-loop.md`; this file owns only the user-facing pauses.

## § 1 — The plan, in chat

Write the decisions and beat list into `STORYBOARD.md` following the recipe, and present the plan in chat as a proposal (shape: `hyperframes-creative/references/story-spine.md` § 3): open by echoing **"This video tells [audience] that [message]"**, then the frame table — one row per frame: frame · beat (type, duration) · on screen · why (its `narrativeRole`, traced to the message). Feedback arrives as a reply here, one revision loop.

In the same message ask two things: **(a)** approve or request changes, and **(b)** **sketches first** (recommended — a quick look at the layouts right after this approval) or skip sketches and build in one go. Iterate until approved: revise exactly the frames the reply names and re-present.

This is a **checkpoint gate** (`brief-contract.md` § 1). A run that starts autonomous normally has `storyboard: no` and does not enter this loop. If mode switches to autonomous mid-run, keep `STORYBOARD.md` current, post the same summary as a heads-up, and continue without waiting; the one kept question comes at § 4.

## § 2 — The sketch pass (collaborative, unless skipped)

The moment the plan is approved, sketch every frame yourself — no sub-agents, no waiting on other steps (sketches don't use timings), straight from the approved frame table.

A sketch is a **static frame, not an unstyled one**: the frame's layout at its key moment, drawn with the full `frame.md` treatment (real fonts, real colors, the actual headline / stat / label text placed where it will live) exactly as `storyboard-recipe.md` § 3 describes a cell, using plain blocks only for panels, charts, diagrams, and media the workflow hasn't produced yet (the workflow says what its blocks stand in for). **No motion** — that arrives with the build pass; the layout, copy and brand treatment are already locked here.

Draw the sketches as the cells of `storyboard.html` (`storyboard-recipe.md` § 3) and hand the user the file path to open in a browser. Mark each frame `built` in `STORYBOARD.md` as its sketch lands. Run no CLI here — no `snapshot`, no `lint` / `check`, no rendering. When every frame is `built`, pause and ask one thing: does the sheet look right, or which frames change? This is a **checkpoint gate**; feedback arrives in chat: revise **only the sketches named**, bump the sheet's version, re-present, and loop until the layout is confirmed. Only then does the workflow's visual design get written onto the confirmed layouts.

A confirmed sheet is also a valid place to **stop**. When the user asked for a storyboard rather than a finished video — a plan to pitch, review, or hand off — `storyboard.html` is the deliverable: confirm it, hand over the path, and go no further unless asked to build.

In autonomous mode, or when the user chose to skip sketches at § 1, skip this pass — frames go straight from `outline` to `animated` in the build.

## § 3 — Building on confirmed layouts

However the workflow builds — sub-agent workers per frame, or inline scene by scene — a confirmed sketch's **composition is settled**: placement, hierarchy, and copy were approved on the sheet, so building means dressing that layout (full design treatment, real assets, motion), never redrawing it. Workflows that dispatch workers put "this frame has a **confirmed sketch** at `storyboard.html#frame-NN`" in the worker's context and carry the keep-the-layout rule in their worker prompt; a landed frame must still read as the approved wireframe, fully dressed.

Mark each frame `animated` as it lands. The build gate carries the loop's condition: in collaborative mode, the sketch sheet was confirmed at § 2.

## § 4 — The final look

After the workflow's checks pass, use the **final composition preview**. In collaborative mode open the Studio preview, hand the timeline URL and ask one thing: render now, or what changes? In autonomous mode this is the one question the mode keeps: ask “preview first, or render?” Open the final preview on yes; render on an explicit render answer. Render only on approval.

**After approval, offer the recipe — once.** An approved run is a proven bundle. At delivery, offer to freeze it: `media-use` → `scripts/recipe.mjs freeze --name <name>` (the workflow comes from BRIEF.md; pass `--workflow` only in a project without one) keeps the design spec, the storyboard skeleton (structure kept, content blanked), the brief skeleton, and the confirmed brief values, and the next run of this type starts from it (the intent layer checks for a matching recipe before its first question). When the freeze lands, teach the recall in the confirmation — "Saved as **<name>** (v<N>). Next time say _make another <name>_, or just _like last time_." — the name is something the system reminds the user of, never something they must remember. In autonomous mode don't ask — name the freeze command in the delivery note instead.
