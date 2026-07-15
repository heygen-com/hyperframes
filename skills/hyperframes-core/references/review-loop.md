# The review loop — plan, sketch, build

How a `storyboard: yes` run earns fidelity one pass at a time: the plan is reviewed as text on a live board, the layouts as wireframe sketches, and the finished piece as the assembled video. Collaborative mode waits at each checkpoint. Autonomous mode posts the same checkpoint summaries and continues, keeping exactly one question before render.

This is the shared process for any workflow that plans on a storyboard. The contracts it leans on live next door: interaction mode, gate types, and the comments channel in `brief-contract.md`; the `STORYBOARD.md` format, the `outline → built → animated` statuses, and the comments sidecar in `storyboard-format.md`. A workflow's SKILL.md says **when** its steps hit each pass and supplies its **sketch stand-ins** (what the plain blocks represent); how the loop runs is defined here, once. The stage mechanics between the passes — audio, frames, assembly, transitions, captions, verify — live in `production-loop.md`; this file owns only the user-facing pauses.

## § 1 — The plan, on a live board

Open the **storyboard board** before presenting the plan: run `npx hyperframes preview` from the project directory in the background, confirm it is serving, and open `http://localhost:<port>/?view=storyboard#project/<project-name>`. This is an early planning surface, not the final composition preview; it may open before composition checks. The plan appears as frame cards and refreshes as work lands.

Present the plan as a proposal (shape: `hyperframes-creative/references/story-spine.md` § 3): open by echoing **"This video tells [audience] that [message]"**, then the frame table — one row per frame: frame · beat (type, duration) · on screen · why (its `narrativeRole`, traced to the message). Hand the board URL with it, noting feedback lands in both places — comment on the board or reply here, one revision loop — and that a board submit still needs one reply here (anything) to get picked up.

In the same message ask two things: **(a)** approve or request changes, and **(b)** **sketches first** (recommended — a quick wireframe look check right after this approval) or skip sketches and build in one go. Iterate until approved — feedback arrives in chat or as the comments file (`brief-contract.md` § 1, the comments channel): revise exactly the frames it names, clear the file, re-present.

This is a **checkpoint gate** (`brief-contract.md` § 1). A run that starts autonomous normally has `storyboard: no` and does not enter this loop. If mode switches to autonomous after a board exists, keep updating the board, post the same summary as a heads-up, and continue without waiting; the one kept question comes at § 4.

## § 2 — The sketch pass (collaborative, unless skipped)

The moment the plan is approved, wireframe every frame yourself — no sub-agents, no waiting on other steps (sketches don't use timings), straight from the approved frame table.

A sketch is a **wireframe with the real words, not a styled frame**: the frame's layout at its key moment — the actual headline / stat / label text placed where it will live, plain blocks for panels, charts, diagrams, and media (the workflow says what its blocks stand in for), `frame.md`'s background and ink plus one accent on the focal, nothing else. No decoration, no full brand treatment, **no motion** — all of that arrives with the build pass.

Keep each sketch a real composition file at `compositions/frames/NN-*.html` (template wrapper, `data-composition-id`, `#root` styling, one paused **empty** timeline registered at `window.__timelines["<frame_id>"]`) so the Studio poster renders — and the poster is the only picture this pass needs: **run no CLI here** — no `snapshot`, no `lint` / `check`, no rendering. A sketch is a few dozen lines of HTML; the whole board lands in minutes.

Mark each frame `built` as its sketch lands — the user's open board fills in blue by itself. When every frame is `built`, pause and ask one thing: does the board look right, or which frames change? This is a **checkpoint gate**; the user reviews in Studio (open since § 1 — restart and re-hand the same URL if the server died), and feedback arrives in chat or as the comments file — check the file first when the reply arrives: revise **only the sketches named**, re-present, and loop until the layout is confirmed. Only then does the workflow's visual design get written onto the confirmed layouts.

A confirmed board is also a valid place to **stop**. When the user asked for a storyboard rather than a finished video — a plan to pitch, review, or hand off — the sketched board is the deliverable: confirm it, hand the board URL, and go no further unless asked to build.

In autonomous mode, or when the user chose to skip sketches at § 1, skip this pass — frames go straight from `outline` to `animated` in the build.

## § 3 — Building on confirmed layouts

However the workflow builds — sub-agent workers per frame, or inline scene by scene — a confirmed sketch's **composition is settled**: placement, hierarchy, and copy were approved on the board, so building means dressing that layout (full design treatment, real assets, motion), never redrawing it. Workflows that dispatch workers put "this frame has a **confirmed sketch** on disk" in the worker's context and carry the keep-the-layout rule in their worker prompt; a landed frame must still read as the approved wireframe, fully dressed.

Mark each frame `animated` as it lands. The build gate carries the loop's condition: in collaborative mode, the sketch board was confirmed at § 2.

## § 4 — The final look

After the workflow's checks pass, use the **final composition preview**. In collaborative mode Studio may already be serving from § 1; hand the timeline URL and ask one thing: render now, or what changes? In autonomous mode this is the one question the mode keeps: ask “preview first, or render?” Open the final preview on yes; render on an explicit render answer. Render only on approval.

**After approval, offer the recipe — once.** An approved run is a proven bundle. At delivery, offer to freeze it: `media-use` → `scripts/recipe.mjs freeze --name <name>` (the workflow comes from BRIEF.md; pass `--workflow` only in a project without one) keeps the design spec, the storyboard skeleton (structure kept, content blanked), the brief skeleton, and the confirmed brief values, and the next run of this type starts from it (the intent layer checks for a matching recipe before its first question). When the freeze lands, teach the recall in the confirmation — "Saved as **<name>** (v<N>). Next time say _make another <name>_, or just _like last time_." — the name is something the system reminds the user of, never something they must remember. In autonomous mode don't ask — name the freeze command in the delivery note instead.
