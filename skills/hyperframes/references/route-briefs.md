# Route briefs — what the intent layer asks, per route

The adaptive half of the intent layer (`/hyperframes` § 4, steps 4–6): each route's entry names the **must-haves** to ask now, the **conditional** questions its input can add, the **deferred asks** to announce (questions that stay in the workflow because their recommendations need pipeline data — a probed clip, a captured site), and whether the two **run-shape questions** (storyboard? · automation or companion?) apply. An entry that names **pitch-eligible** fields sends an unformed request through the pitch round (`pitch-round.md`) after routing; the chosen concept answers those fields. An entry without that line never enters the round. These entries live here, in the router skill, because workflow skills install lazily — at routing time the matched workflow may not be on the machine yet.

Field semantics and question rules: `hyperframes-core/references/brief-contract.md` § 2–3. Every question: recommended option first, receipt attached; a remembered value becomes the recommendation with its source named. The intro text of the brief always states **message** and **language** (state, don't ask).

## `/faceless-explainer`

- **Must-haves:** **angle** — concept / how-to / listicle / narrative, recommend the one the text's own shape suggests · **length** — inside the 30–90s sweet spot, scaled to how much the text actually teaches · **destination** — YouTube / embed → 16:9 · X / LinkedIn / Instagram feed → 1:1 · Shorts / TikTok → 9:16.
- **Conditional:** a pasted script adds **`VO_MODE`** — use it verbatim, or restructure per scene?
- **Pitch round:** `message` + `angle` — five tellings of the same topic are five different videos.
- **Run-shape:** both.

## `/product-launch-video`

- **First, sell or show?** One question when the request doesn't say: market the product (a promo), or show the site as-is (a tour / showcase)? A show-it answer is **intent, not a different pipeline**: write it into `BRIEF.md` (`## Intent` / `## Customizations` — "feature the site's own captured screens as the video's assets") and the workflow's normal steps carry it — the captured screens become the featured `asset_candidates`.
- **Must-haves:** **angle** — story shapes from the site's / brief's own positioning, recommend one with its basis · **length** — 30–90s sweet spot, scaled to the material · **destination** — as above.
- **Conditional:** a show-it-as-is ask adds **what to show** — the whole site, or specific pages/sections (into `BRIEF.md`'s body); a pasted script/brief adds **`VO_MODE`** (verbatim or restructured?); a script that only names a site adds **capture?** — crawl it for brand + assets (default), or text-only / "don't scrape" (no-capture mode, a preset supplies the design system).
- **Pitch round:** `message` + `angle`, after sell-or-show is settled — the pitches inherit that intent.
- **Run-shape:** both.

## `/pr-to-video`

- **Must-haves:** the **PR reference** (URL, `owner/repo#N`, or "this PR") · **angle** — changelog / feature-reveal / fix-explainer / refactor-walkthrough, recommend the one the PR itself suggests · **audience** — developers (default) · mixed technical · non-technical stakeholders · **length** — from the size table below · **destination** — 16:9 is the default for a code explainer.
- **Length comes from the PR's change size**, not a fixed guess — peek once, read-only (the workflow's Step 1 still does the full deterministic fetch):

  ```bash
  gh pr view <PR_REF> --json title,additions,deletions,changedFiles
  ```

  Pick the tier from `additions + deletions` (nudged up by `changedFiles`) and lead with it (hard cap ~3 min):

  | PR change size                    | Recommended length |
  | --------------------------------- | ------------------ |
  | trivial (≲ 50 lines changed)      | ~20–40s            |
  | focused (~50–200 lines)           | ~40–70s            |
  | substantial (~200–600 lines)      | ~70–110s           |
  | large (≳ 600 lines, or 25+ files) | ~110–180s          |

  State the basis in one phrase ("~40s — small change, +44/−13 across 12 files"). The tier is a **ceiling** on how much story the diff can support, never a floor to fill: a one-headline story recommends inside 30–90s regardless of tier (the tier's range may still appear as a non-recommended fuller-walkthrough option).

- **Pitch round:** `angle` and the opening hook — the diff fixes the facts, not the telling.
- **Run-shape:** both.

## `/general-video`

- **Open-ended requests only:** first derive a one-sentence `message`. Ask `audience` only when it is unclear and would change the story or terminology. Ask `destination` only when it would change aspect or composition. Ask for a priority only when the brief contains a real trade-off. Default to one best version; ask about variations only when the user requests options or comparison.
- **Specific requests:** a complete ask such as “a static title card with our logo for a website hero” needs no discovery questions.
- **Pitch round:** `message` — the unformed open-ended request is this round's home case.
- **Run-shape:** both questions apply. `/general-video` is also the companion host, so `flow: companion` stays on this route with the full toolbox.

## `/music-to-video`

- **Must-haves:** the **music source** — a track file, a video to pull audio from, or generate one from a mood description · **destination → aspect**.
- **Deferred (announce):** brand (font + palette) and the genre feel are chosen at its Step 3 by design — they emerge from the track's analysis, not from a question up front.
- **Pitch round:** `message` — the visual concept riding the beat grid (lyric treatment, montage story, kinetic type); brand and genre feel still land at Step 3.
- **Run-shape:** both.

## `/motion-graphics`

- Autonomous by design: at most **one** clarifying question, owned by its director step, in the flow. No must-haves here beyond confirming the input; route directly.
- **Run-shape:** neither — the piece is seconds long; a board and a companion session have nothing to add.
- **Front-door capability offer:** skip it. The director's one-question limit is authoritative.

## `/slideshow`

- The one question is the routing confirmation itself — "do you want this as a HyperFrames slideshow?" — asked during triage (it survives every mode: wrong routing is a quality problem). The deck contract owns everything after.
- **Run-shape:** neither — the deliverable is a navigable deck, not a rendered video.
- **Front-door capability offer:** skip it. After route confirmation, the deck workflow owns all remaining choices.

## `/embedded-captions`

- **Must-haves:** which clip (the input file).
- **Deferred (announce):** the caption **identity** pick — its Step 0 probes the clip first, then shortlists 2–3 identities from the catalog and recommends one. Say that's coming.
- **Run-shape:** neither — the footage is untouched; there is no storyboard to review.

## `/talking-head-recut`

- **Must-haves:** which clip (the input file).
- **Deferred (announce):** its render-strategy questions — aspect ratio, layout, style group, card count — stay at its Step 7, where the recommendations come from the probed footage and transcript. Say they're coming.
- **Run-shape:** neither.

## `/remotion-to-hyperframes`

- Not served by the intent layer — a migration with no brief. Route directly.
