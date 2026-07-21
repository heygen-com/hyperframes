# Story design — product launch video

Step 3 of the product-launch flow. Output: `STORYBOARD.md` (the narrative plan, one frame per beat) and `SCRIPT.md` (the locked spoken narration).

This step decides **what the video says, in what order, and how each beat is said** — and it says each beat in the SHAPE of a proven script. It does not design layout, composition, or motion (that is Step 4). For exact file syntax follow `../hyperframes-core/references/storyboard-format.md` and `../hyperframes-core/references/script-format.md`.

## What story design produces

For every beat, four things:

1. **Position in the SEQUENCE** — the shot order. Story truth decides which beats exist and in what order (the arc).
2. **Voiceover written in a blueprint's script shape** — the spoken line, drafted to sound like the proven script for the shape this beat is reaching toward (see the script bank below).
3. **A candidate `blueprint:` id** — the proven shot SHAPE this beat leans toward (a tag, not a commitment; Step 4 confirms or overrides).
4. **`transition_in`** — how this beat enters from the one before it.

The big idea: **the blueprint is applied from the very first step.** The blueprints were reverse-engineered from 50 golden clips; each one implies a proven script. So we write the VO in that script's shape from the start — the voiceover is blueprint-shaped before Step 4 ever runs, which makes the blueprint's hit-rate downstream high.

This is still a SOFT discipline. Story truth comes first: **never invent, bend, drop, or reorder a beat to fit a blueprint.** The script patterns only shape HOW a beat is said and which proven shape it leans toward — they never decide which beats exist.

## Read first

1. `hyperframes.json` — locked brief: angle, length, aspect ratio, language.
2. `frame.md` — tone, mood, design system, brand register.
3. `capture/extracted/visible-text.txt` — product facts, page copy, positioning, proof, CTA.
4. `capture/extracted/asset-descriptions.md` — the ONLY source for the captured asset inventory.
5. `user_script.txt` and `VO_MODE`, when present.

Do not inspect `capture/assets/`, contact sheets, screenshots, or raw files in Step 3. Treat `asset-descriptions.md` as the canonical asset list. Never invent asset filenames.

## Method

### 1. Extract the product truth

From the brief and captured text, name:

- **Audience** — who the video speaks to.
- **Pain / desire** — what they already want fixed or achieved.
- **Promise** — the one-line thesis of the whole video.
- **Product role** — what the product does in the story.
- **Proof** — features, UI moments, metrics, logos, demos.
- **CTA** — what the viewer should do next.

Build the sequence around the **promise**, not a feature list. A website is an information layout; a video is an emotional sequence. Reorder, merge, and omit captured content freely — do not follow page order.

### 2. Choose the arc (the sequence backbone)

Pick ONE arc — it fixes the beat order. Compound only when useful (e.g. `PAS with feature-benefit progression`).

| Arc                       | Use when                                         | Beat order                                                                  |
| ------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `PAS`                     | Pain is known and urgent (broken B2B workflows). | hook → pain → agitation → solution tease → product intro → proof/demo → CTA |
| `Future Pacing`           | Sells a new future / category / paradigm.        | imagine → name product → remove pain → mechanism → outcome → CTA            |
| `Demo Loop`               | UI is self-explanatory; best shown working.      | question → product intro → demo cycle 1 → demo cycle 2 → trust → CTA        |
| `BAB`                     | Bridges an old workflow to a better one.         | before → after tease → bridge/product → step 1 → step 2 → wow → CTA         |
| `Feature-Benefit Cascade` | Feature-rich or desire/status-driven.            | category hook → feature → benefit → feature → benefit → climax → CTA        |

Use feature→benefit rhythm inside any arc when there are many capabilities — always translate a feature into viewer value, never stack raw features.

`frame.md` tunes the VOICE, not the arc: restrained/B2B → plain, low-hype; bold/launch → short, punchy; warm/human → friendly direct address; premium/cinematic → aspirational, fewer words.

### 3. Lay out the beats, each with a role

One clear job per beat — never "more benefits" or "another feature." Beat `type` (= blueprint **role**):

`hook | pain_point | product_intro | feature_showcase | benefit_highlight | social_proof | branding | cta`

The opening 3–5s needs ONE hook that creates tension, curiosity, or desire — a shocking stat, pain validation, a rhetorical question, direct address, an imagine/future-pace, a category announcement, or visual spectacle. Never open with generic company description. Per `../hyperframes-creative/references/story-spine.md`: the hook speaks the viewer's outcome language (what they gain, never a feature list), and the promise (`message`) lands by beat 2 — features after that are its evidence.

A UI demo is usually a SEQUENCE of 3+ consecutive `feature_showcase` / `benefit_highlight` beats on the same surface (input → response → result → benefit), not one isolated frame.

### 4. Write each beat's VO in its blueprint's script shape

For each beat, look up its **role** in the script bank below, find the blueprint whose SHAPE fits the beat you already chose, and **draft the voiceover to sound like that blueprint's pattern.** Tag the candidate `blueprint:` id on the frame.

- The bank is the heart of this step: proven product-launch clips reversed into the one VO line each implies, grouped by role → blueprint, each with a **pattern** to imitate.
- If two blueprints fit the beat, prefer the one whose script shape matches the line you'd naturally write.
- If NO shape fits the beat, omit `blueprint:` and write the VO plainly — Step 4 composes that frame freely. Do not force a wrong shape.
- **Vary the shapes across the video.** Reaching for the same blueprint every beat re-creates the sameness this exists to avoid. `kinetic-type-beats` is the workhorse (6 roles) — lean on it, but not everywhere.
- **Write each VO as discrete cues, not one run-on breath.** Step 5 reveals each on-screen piece _when the voiceover names it_ (the anti-PowerPoint mechanism — `motion-language.md` Part 2). A line with clear phrase boundaries — "Content, sentiment, engagement — in one place" — hands the shot its reveal cadence for free; a single long clause leaves the frame nothing to pace to. The bank patterns are already cue-segmented — keep that rhythm.

Step 3 only TAGS the candidate id and writes the shaped VO. Step 4 (visual design) picks and instantiates the blueprint into a time-coded shot; it may override or drop a Step 3 candidate. The full menu with picking guidance lives in `../hyperframes-animation/blueprints-index.md`.

---

## The script bank — what each beat's VO sounds like

> Proven product-launch clips, each reversed into the one spoken line it implies. Grouped by **role → blueprint**. Real product names kept (swap in your own). Draft your beat's VO in the SHAPE of the matching pattern. Kept 1:1 with the role declarations in `../hyperframes-animation/blueprints-index.md` — when a blueprint gains a role there, add its script shape here.

### HOOK

**kinetic-type-beats** — the words ARE the motion

- Mailoji — "Still using a @gmail address? Or @outlook, or @hotmail, or @yahoo?"
- Outrank — "Getting traffic is hard. Insanely hard."
- AiAgent — "An AI agent that's easy to use — and optimised for you."
- Uizard — "Transform your sketches into prototypes — automatically."
- _Pattern:_ a punchy claim or rhetorical jab whose KEY WORD swaps in place (or escalates beat by beat) — the swap/escalation is the joke.

**typewriter-reveal** — someone is typing this

- "Need answers about your audience — right now?"
- Contra — "You are more than your job title. You are more than your resume."
- _Pattern:_ a relatable line typed live and edited mid-stream (a word backspaces and retypes) — the everyday thought, in your own words.

**spatial-pan-stations** — a panned timeline

- Rows — "From VisiCalc to Excel to Google Sheets — the spreadsheet has barely changed since 1979."
- _Pattern:_ a march of named milestones across time, landing on "...until now / ...up to us."

**constellation-hub** — nodes ring a center, camera pushes in

- "Content, sentiment, engagement, analysis — every platform you're on, in one place."
- _Pattern:_ a spread of tools/channels collapsing onto one center — "it connects everything."

**ticker-takeover** — options cycle, then a hero crashes in

- Notion — "A doc? A database? A wiki? — no, it's all of them, in one place."
- _Pattern:_ a "could be X, or Y, or Z?" cycle on one swapping word, then a hero claim crashes in and replaces it — "actually, this is what it is."

**prompt-type-submit-generate** — watch me ask

- "Build me a landing page for my coffee brand — dark, minimal, launch-ready."
- "What if you could just… ask?"
- _Pattern:_ the VO speaks (or frames) the ask itself while the prompt types live — the question is the whole hook; the answer stays off-screen, or a second ask starts before the cut.

**zoom-out-workspace-reveal** — the mystery re-scopes

- "This isn't a finished animation — it's your canvas."
- _Pattern:_ near-silence or one slow tease over the close-up mystery, with the landing line timed to the zoom-out — the words answer "what am I looking at?" exactly when the workspace does.

**fixed-anchor-cycle** — a roll-call around a pinned line

- "For founders, for designers, for marketers, for teams — for anyone who ships."
- _Pattern:_ one static claim holds while its audience/option list cycles fast beneath it — the list is the sentence's swapping object, and the brand line lands after the cycle clears.

**cursor-ui-demo** — a canvas already alive

- "Your whole team is already in here — designing, commenting, shipping."
- _Pattern:_ a "we're all here working" line over an ambient multi-cursor canvas — presence, not features; the live activity is the proof.

**dataviz-countup** — cold-open on one exploding stat

- "One million users. Ninety days."
- _Pattern:_ ONE statistic counts up as the VO speaks it — scale alone carries the tension; no product, no context yet.

**cta-morph-press** — a lone widget does its trick

- "It starts as a search bar. It becomes your whole workflow."
- _Pattern:_ one small widget on a bare field morphs in place and performs its payload while the VO names the transformation — small thing, big claim, hand off to the title.

### PROBLEM

**kinetic-type-beats** — pain lands alone on a bare canvas

- Butter — "What if your sessions didn't have to be boring and unstructured — or buried under a dozen tabs?"
- SmartCue — "You asked for better leads. We were the cure — MQLs that actually convert, a sales team that becomes your ally."
- _Pattern:_ 3–5 short pain statements (or a "what if?" framing), each landing solo before the next — no product yet.

**spatial-pan-stations** — a panned web of pain

- Vauban — "Coordinating legal documents, signatures, and cross-border transactions — it's a tangled mess."
- _Pattern:_ pain "stations" traversed one by one, ending on a knot — "too many disconnected steps."

**dataviz-countup** — the data IS the argument

- "67% of professionals say leadership is disconnected — and it's costing them a 65% boost in profitability."
- _Pattern:_ a count-up / chart / stat the camera pushes through to dramatize a worsening or large-scale problem.

**overwhelm-surround** — buried by your own tools

- "Slack, email, docs, tickets, three more tabs — and somehow it all lands on you."
- _Pattern:_ recognizable tools pile in until they surround and bury the viewer — the pain is being swamped, not one bad number.

### PRODUCT_INTRO

**kinetic-type-beats** — "Introducing…" name-drop

- "Elevating experiences, removing manual touchpoints, automating processes — so you can focus on the customer."
- Uizard — "Introducing Uizard — the design tool for everyone."
- _Pattern:_ hard-cut through "Introducing…" / tagline / value beats and resolve on the brand name or logo.

**logo-assemble-lockup** — wordless premium sting

- Manifold — "Manifold." _(wordless mark assembles; VO optional — just the name)_
- _Pattern:_ an abstract system assembles around a fixed mark — no copy, or just the product name landing.

**cursor-ui-demo** — first cursor-led look

- ClickUp — "This is ClickUp — click through and watch your whole workspace change."
- "Pull up any contact, find the right advisor, and you're matched in seconds."
- PaLM 2 — "Meet PaLM 2 — what is it, what can it do, and how was it built?"
- _Pattern:_ a cursor sweeps in to introduce the surface — a light first look landing on a hovered hero element or fresh result.

**dataviz-countup** — open on the result

- SuperX — "X growth — discover what really works: 19.6 million impressions."
- _Pattern:_ a confident "look at the data / the result" open — scroll a tilted card grid to one glowing hero metric, tagline assembling word by word.

**video-text-pivot** — show it work, then the number

- "Watch it run — then look at what it saved: 14 hours, every week."
- _Pattern:_ the product video plays, then slides aside to hand the frame to one impact stat — "see it work, now see what it's worth."

**prompt-type-submit-generate** — something you talk to

- "Meet Ada — describe what you need, attach what you have, and let it run."
- _Pattern:_ the first look IS the composer — the VO introduces the product as a conversation partner while a long prompt types with attachments and option picks, ending on (or just after) the submit.

**spatial-pan-stations** — decode the idea, then land on it live

- "Capture, structure, publish — that's the idea. Here it is running."
- _Pattern:_ a labeled concept strip read station by station, the final pan bridging into the live demo — "here's the idea → here it is working."

**device-surface-showcase** — introduced by completing its core loop

- "Open a space, drop in your notes, hit share — that's it, that's the product."
- _Pattern:_ the product introduced by DOING its core loop once inside its real interface, stepwise and cursorless — the VO narrates the steps plainly and lands on "that's it."

**titlecard-reveal** — a near-still title prelude

- "Relay. Docs that write themselves. Let's look inside."
- _Pattern:_ 2–3 near-still cards seamed by blur-snap handoffs — name, one-line claim, then into the product; each card carries one short spoken phrase.

### KEY_FEATURE

**grid-card-assemble** — enumerate breadth at once

- Postcards — "Want more? Unlimited exports, 1,400 fonts, an AI assistant, version history — and it's free to try."
- ClearVPN — "ClearVPN is built to help you: streaming access, secure browsing, location changing — only the essentials."
- Copilot — "Command bar, Zapier, white-labeling, API, SOC2 — and a whole lot more."
- _Pattern:_ a tile/pill/card grid self-assembles to show many capabilities at once — "look how much it does."

**cursor-ui-demo** — one workflow, end to end

- "Scroll your feed, then jump straight to your notifications — it's all one click away."
- Flowrite — "Pick your recipient, set your intention, choose a tone — and Flowrite writes it for you."
- Descript — "Tune your edits, add a crossfade, automate the volume, normalize loudness — then export."
- _Pattern:_ one specific multi-step workflow shown end-to-end across 2–4 real edits, landing on the action button or result.

**device-surface-showcase** — experienced inside its real interface

- HRS — "Your flight's cancelled — so book a hotel, a taxi, and get reimbursed, all in one digital journey."
- HelpKit — "A dynamic table of contents that follows your readers as they scroll."
- Graphite — "Use unique themes, recolor one element or several, and configure it all in a handy window."
- Contra — "Pick a template, make it yours, and launch a portfolio that's unmistakably you."
- _Pattern:_ a feature shown being USED inside its real surface — the device/window is the hero and its screens advance through a flow.

**comparison-split** — two paired capabilities, side by side

- "Design on the left, code on the right — always one source of truth."
- _Pattern:_ two complementary capabilities of equal weight shown together — "X and Y, in lockstep."

**video-text-pivot** — the feature, then its result

- "Here's the editor in action — and the result: a publish-ready cut in minutes."
- _Pattern:_ a feature clip runs, then yields the frame to a metric / impact line — the clip proves it, the number lands it.

**prompt-type-submit-generate** — one ask, one answer

- "Ask for revenue by region — and the chart draws itself."
- _Pattern:_ ONE prompt→response round trip — the VO names the ask, lets the status theater breathe a beat, then calls the result as it streams in.

**agent-progress-theater** — the machine visibly works

- "Kick off the scan — it checks every file, flags what's broken, and fixes what it can. Watch."
- _Pattern:_ trigger → working theater → receipt: the VO hands the work over, then reads the findings as rows land and check off — present tense, the machine is the subject.

**panel-edit-live-sync** — one gesture, two surfaces

- "Drag the value — the button follows. Pick a unit — the code converts. Live."
- _Pattern:_ 2–4 short cause→effect couplets, each pairing a gesture with its live mirror ("do X — Y answers"), ending held on the last edit.

**transcript-scroll-artifact-reveal** — the work, then the deliverable

- "It planned, researched, built, and tested — and left you the spreadsheet to prove it."
- _Pattern:_ a "look how much happened" line read down the transcript at traversal pace, then one pivot line cashes it in on the artifact — evidence first, payoff last.

**camera-journey** — a cinematic flight over the result

- "A month of content — planned, scheduled, and ready before you sat down."
- _Pattern:_ a flying camera explores the generated artifact while the VO makes one calm, sweeping claim; the content acts by itself — no hands, no clicks.

**dataviz-countup** — the numbers prove the feature

- "Response time, down 40%. Coverage, 3×. Every claim, a number."
- _Pattern:_ the feature proven by its metrics — a stat montage scrubbed / counted up while the VO reads each number as it lands.

### BENEFITS

**kinetic-type-beats** — rapid-fire value montage

- AiAgent — "No API keys, GPT-4 access, simple UX, clean UI — moving fast."
- Uizard — "Export to Sketch, create style guides, share, collaborate — and code less."
- _Pattern:_ a staccato montage of 8–12 short value phrases, each flashing and clearing at high tempo.

**grid-card-assemble** — an accumulating value list

- Lineicons — "Consistent and clean, tons of free icons, a Figma plugin, a powerful editor, every format you need."
- Plutio — "Manage projects, track time, send invoices, write proposals — all deeply customisable."
- _Pattern:_ short value phrases populate a vertical list ~1/sec, co-resident and accumulating, each popping into its slot.

**titlecard-reveal** — the calm value beat

- CSS Scan Pro — "A smart color picker — with instant tints and shades."
- _Pattern:_ one clean two-line value title, one slide-up crossfade, then held still. Low motion is the point.

**camera-journey** — travel the value chain

- "Leave one comment here — and the forecast updates over there."
- _Pattern:_ a cause→effect round trip: the VO's first half lands on the action, its second half on the payoff the camera travels to — "do this small thing here, get this big thing there."

**zoom-out-workspace-reveal** — this is just one corner

- "That one file it fixed? A corner of everything it already did."
- _Pattern:_ the VO tells the micro-story during the close-up dwell, then the scale line lands with the zoom-out — the benefit is breadth, revealed in one move.

**fixed-anchor-cycle** — everything changes, this stays

- "Same prompt. Every tool you own."
- _Pattern:_ one pinned claim while the entire surface re-skins around it — a short "works everywhere" line, then let the cycling themes speak.

**cursor-ui-demo** — demo, value line, demo

- "Watch it draft the reply — that's an hour back — now watch it file the ticket."
- _Pattern:_ a demo|text|demo sandwich — the VO alternates showing and telling, naming the value in the text beat between two live interactions.

### SOCIAL_PROOF

**constellation-hub** — the hub at the center of your stack

- kyvos — "On any BI tool — Tableau, Looker, Power BI — Kyvos sits at the center of your stack."
- "Connects to thousands of apps — including every one you already use."
- _Pattern:_ the product mark is the hub and partner logos orbit it — "sits at the center of everything you use." In the scatter-drift end-card variant there is no hub and no ring: a serif claim holds center while app icons pop in scattered and drift slowly outward — breadth said with count and spread, not geometry.

**grid-card-assemble** — a logo wall pulling back to a vast ecosystem

- Lineicons — "Used by more than 100,000 designers, developers, and companies — including these."
- ClickUp — "Connect Google Drive, Slack, GitHub, Stripe — your whole ecosystem in one place."
- Copilot — "With thousands of partner apps — Airtable, Calendly, Jira, Asana — you can embed anything."
- _Pattern:_ a wall of partner/app logos builds, then a camera zoom-out reveals a vast ecosystem.

**titlecard-reveal** — busy → clean proof card

- Trumpet — "We supply the trumpet, you bring the band — loved by 1,000+ sales, success, and marketing teams."
- _Pattern:_ wipe a busy open away to a clean lockup plus a "loved by N+ teams" line that settles and holds.

**dataviz-countup** — the numbers vouch

- "Twelve thousand teams. 4.9 stars. 99.98% uptime."
- _Pattern:_ proof by count-up — adoption, rating, and scale metrics tick up as the VO reads them; the biggest number lands last.

### CTA

**kinetic-type-beats** — punchy closing line beat-by-beat

- Stylebit — "Go pro, connect up to five Figma accounts — more features coming. Join now."
- revid.ai — "Boost your engagement and turbocharge your social media."
- _Pattern:_ a closing line (or short value stack) that snaps in beat by beat and lands on the logo or URL.

**logo-assemble-lockup** — logo build → push-through into the URL

- Strapi Cloud — "Deploy on Strapi Cloud — no server hassle, same flexibility. Try it now at strapi.io/cloud."
- Highlander — "Highlander is ready for the future you're building. Let's raise — at highlander.ai."
- STUDIO AI — "Get early access to STUDIO."
- Glorify — "Get started for free now — no credit card required."
- _Pattern:_ the logo builds, a fast camera push-through streaks giant CTA letters past the lens, resolving on the URL or action verb.

**cta-morph-press** — identity condenses into one click

- Linear — "This is Linear. Start building — it's free."
- _Pattern:_ the brand mark condenses straight into the single thing you click — "here's us → click here," no spatial set.

**prompt-type-submit-generate** — the command is the ask

- "One command — npm install relay — and you're live."
- _Pattern:_ the closing invitation IS a typed install command — the headline demotes, the terminal pill types it out, and the VO speaks the command (or one short line over it); the card holds with only the caret blinking.

**constellation-hub** — the orbit collapses into action

- "Everything you use, one hub — click, and it's yours."
- _Pattern:_ the ecosystem ring collapses onto the core on one click that springs the product open — the VO turns "it connects everything" into the action line.

**titlecard-reveal** — a calm end-card stack

- "Try it free. No credit card. relay.app."
- _Pattern:_ 2–3 near-still cards hard-cut in sequence, one short closing phrase each, terminating on the held logo/URL — the calm is the confidence.

### BRAND_OUTRO

**kinetic-type-beats** — a verb barrage resolving on one word

- Phantom — "Buy, store, stake, swap, send, connect, explore — multichain."
- _Pattern:_ a rapid center-channel barrage of single-word verbs asserting breadth, resolving on the brand's one defining word. No logo lockup needed.

**typewriter-reveal** — persistent mark + typed CTA rail

- Collato — "Next time, just Collato it — sign up for free today."
- _Pattern:_ the mark holds dead-center the whole time while a sub-line types or swaps into the final CTA.

**logo-assemble-lockup** — elements clear, the lockup draws itself in

- Copilot — "Copilot." _(pills disperse off-frame, the mark draws on; VO optional — just the name)_
- Dora AI — "Dora AI — join the waitlist."
- _Pattern:_ feature/UI elements clear the stage off all four edges, then the logo mark draws itself on and the wordmark completes the lockup.

**ticker-takeover** — use-cases cycle, the brand takes the frame

- "For notes, for tasks, for plans, for teams — [brand] holds it all."
- _Pattern:_ closing use-cases/verbs cycle through one slot, then the brand mark crashes in and owns the final frame.

**fixed-anchor-cycle** — the anchor holds, the words cycle

- bolt.new — "Prompt, run, edit, deploy — enjoy."
- Anthropic — "Opus 4.6 — by Anthropic."
- _Pattern:_ the brand name sits immovable while tagline words or praise quotes cycle beside it — per-word highlight stepping, or an accelerating flurry — landing on the completed lockup.

---

## VO_MODE handling

**No pasted script** — write the VO yourself, in the matching blueprint's script shape:

- 1–2 sentences per spoken beat, usually 6–20 words.
- Concrete and human; active verbs; say what the product does for a person.
- Avoid: "seamless experience," "unlock the power of," "streamline your workflow," long noun-phrase lists, a whole beat that is just "Or…".
- Silent beats are allowed when the visual proves the point — leave them out of `SCRIPT.md`.

**`VO_MODE = restructure`** — treat `user_script.txt` as source material. Rewrite, reorder, merge, or omit to fit the arc and target length. You may still shape each segment toward its beat's blueprint pattern.

**`VO_MODE = verbatim`** — do NOT change the user's words. Segment the script into beat-sized chunks at sentence/paragraph boundaries (split a long sentence only at a natural clause boundary). Final duration follows the provided script. Blueprint shaping does not apply to wording — only to which shape each verbatim chunk is paired with.

## Asset candidates

`asset_candidates` is the Step-3 → Step-4 handoff. Rules:

1. Read only `capture/extracted/asset-descriptions.md` to know what exists.
2. Use only filenames listed there; write as `assets/<basename>`.
3. One line, candidates separated by semicolons, a short description after `—`.
4. Prefer `[video]` assets when motion proves the product better than a still.
5. Use content assets (UI, screenshots, product photos, charts, demos). Skip tiny icons, favicons, badges, decorative chrome, repeated logo variants — unless the beat needs them. Partner / third-party logos come from `/media-use` (`resolve --type logo --entity <brand>`) — never redrawn by hand.
6. Pure-typography beats may use an empty asset list. Do not use nested lists.

Example:

```md
- asset_candidates: assets/dashboard-hero.png — dark analytics dashboard, wide screenshot; assets/demo-loop.mp4 — query-to-result interaction clip
```

## transition_in

Between-frame transition — how each frame ENTERS from the one before it. The harness's injector stamps it onto the two whole-frame clips (opacity / transform / filter on the frame wrappers). Name a **registry type** directly; optionally add a direction and/or a duration (`push-slide LEFT`, `crossfade 0.4s`). `cut` / `none` / empty = a hard cut.

The five registry types:

- **`crossfade`** — a plain opacity dissolve; the neutral choice when two frames sit in the same visual world.
- **`blur-crossfade`** — dissolve through a soft blur + slight scale; use when the two frames' backgrounds differ a lot, so the blur masks the color clash a plain crossfade would expose.
- **`push-slide`** `[LEFT|RIGHT|UP|DOWN]` — outgoing slides off, incoming pushes in from the opposite edge; a lateral "next beat" feel for a run of consecutive cards / feature beats.
- **`zoom-through`** — outgoing scales up + blurs out, incoming scales up from small into focus; for a STATE CHANGE / turning to a new section (hook → context).
- **`squeeze`** — outgoing compresses to a line on one edge as incoming expands from the other; a snappy, mechanical beat change.

Pick a small set and repeat them: default to `crossfade` (or `blur-crossfade` when the backgrounds clash), and reach for `zoom-through` at section boundaries. Frame 1's `transition_in` is a placeholder.

## Music & silence

The storyboard's top YAML block carries a `music:` field — the BGM mood the audio step retrieves against (e.g. `music: confident minimal tech underscore`). Omitting it falls back to `message:` → `arc:` → a neutral default, so BGM plays unless turned off explicitly.

- **`music: none`** — BGM off (narration, if any, still runs).
- **`music: none` + no `SCRIPT.md`** — the canonical **fully-silent marker**: no narration, no BGM, no SFX. `audio.mjs` generates nothing and Step 3.1 is a clean skip. Use exactly this spelling when the user asks for a silent / music-free video.

## Frame template

Use the exact fields required by the core storyboard format. The narrative shape each frame satisfies:

```md
## Frame N — Short name

- scene: one clear visual idea
- voiceover: "spoken line, written in the candidate blueprint's script shape, or empty"
- duration: rough estimate in seconds
- transition_in: crossfade
- status: outline
- src: compositions/frames/NN-short-name.html
- type: hook
- persuasion: Pain validation
- beat: urgency
- blueprint: kinetic-type-beats — candidate shape from the role→blueprint menu; omit when none fits
- asset_candidates: assets/example.png — short asset description

narrativeRole: what this beat does in the viewer journey.
keyMessage: the one idea the viewer should remember.
```

- `persuasion` — a concrete move (Pain agitation, Negative contrast, Friction reduction, Show-don't-tell proof, Feature-to-benefit translation, Statistical proof, Authority by association, Social proof, Risk reversal, Future pacing, Value stacking, Rule of three, Scarcity/urgency, Status seeking…). Never "show benefit." Invent one if none fits and explain it in the prose.
- `beat` — a specific emotion (anxiety, frustration, overwhelm, tension, urgency, skepticism, FOMO → relief, curiosity, clarity, intrigue, aspiration → trust, confidence, control, ease, power, awe, excitement, belonging → triumph, motivation, urgency-to-act, peace of mind, inevitability). Compound allowed (e.g. `relief + control`).

## Final checklist

- The arc is named; the sequence is narrative-driven, not page-order-driven.
- The opening uses one clear hook strategy that creates tension/curiosity/desire.
- Each beat has one job; every beat has `type`, `persuasion`, `beat`.
- Each beat's `voiceover` is written in its candidate blueprint's script shape (from the bank), with the candidate `blueprint:` tagged wherever a shape fits — and omitted where none does.
- Each `voiceover` is phrase-segmented into cues (each cue a piece Step 5 can reveal on) — not one long run-on clause.
- Shapes vary across the video; no single blueprint on every beat.
- Story truth was never bent to fit a blueprint — no beat invented/dropped/reordered for a shape.
- Every visual beat has suitable `asset_candidates` (filenames only from `asset-descriptions.md`), unless intentionally typography-only.
- UI/product demos use a multi-beat sequence when the value depends on workflow.
- `transition_in` is a registry type (`crossfade` / `blur-crossfade` / `push-slide` / `zoom-through` / `squeeze`) — default `crossfade` (`blur-crossfade` on a background clash), `zoom-through` at section boundaries, repeated across the video.
- `SCRIPT.md` contains only locked spoken narration; silent beats are intentional and omitted.
