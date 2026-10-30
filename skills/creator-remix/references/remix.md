# Making the episode

The template holds every rule and tool; this file sets the order and the discipline. When this file and the template disagree, the template wins, except on the length the person picked (§3) and on Pro and credits (SKILL.md).

Order: `read → settle the voice → say what's coming → ask (only what is open) → facts + script → stop 1 (storyboard) → voice → face → footage → shot plan + build → checks → stop 2 (draft) → render → reply`

## 1. The template

- It is in `templates/<slug>/`: CHANNEL.md (the channel: identity, caption skin, title look, rights) and one `series/<series>/` folder with TEMPLATE.md, REMIX.md, voice.md, frame.md, editing.md, footage.md, sound.md, `components/` and `kit/` (the starter project and its tools, with its fonts, sound and assets). A drawn series adds STYLE.md and `kit/engine/`.
- Where a template names something only the HyperFrames app has (`media.find`, `voice.cloneVoice`, the Storyboard tab), use its command-line route or what this file says.

## 2. Read in this order

1. CHANNEL.md.
2. `series/<series>/TEMPLATE.md`: what the episode is, its runtime, the slots, what topics it is good and not good for. A topic it is not good for: say so in one line and offer the nearest angle that fits.
3. `series/<series>/REMIX.md`. **Its step table is the process.** Follow it in order and skip nothing.
4. `series/<series>/kit/README.md`: the tools, their Python packages and the project they build.
5. Every other file when a REMIX.md step points to it. editing.md lists every component with the creator's own use of it; footage.md says what to show for each kind of line and where to find it.

## 3. What to ask, once

The person's message carries what it carries. Ask once, together, only what is still open: the topic, the length, the voice and, for a presented series, the face.

- **Only the person's own voice and face.** Never a HeyGen stock voice or presenter, never the creator's face, voice, footage, wordmark or show name. A presented series with no face answered: ask for it once, and make nothing paid until it is answered.
- **A presenter runs on the plan by default.** Recommend the person's own HeyGen avatar once, in one line: it looks best, goes through the `heygen` CLI and bills that login, not the plan. It is only a recommendation. No avatar, no `heygen` or they'd rather not: say in one line that you'll make the presenter with HeyGen Video 1 on their plan, from their photo, and go on.
- **Settle the voice before any research.** A HeyGen voice id the person gave is the voice: use it and ask nothing. Anything else: with `heygen` signed in, look in `heygen voice list`. One clone: use it. Several: ask which. None, or no `heygen`: ask once for their voice id, for a clone they make in HeyGen from 30 s to 3 min of their own reading, or for their own recorded narration. Nothing else starts until this is settled.
- **Then say what's coming** in one short message that is not a question, and go on without waiting: the working title and hook, the length, and roughly how long it takes. No prices.
- **The length is the person's, and it beats the template's runtime.** Offer about 1 minute first: the cold open, the title beat and one chapter, the end card short. 2 to 4 minutes: REMIX.md's short cut. A full episode: the series' own runtime. Their own words ("90 seconds", "5 min"): that length. No length answered and none in the topic: about 1 minute, and offer the longer cut in the reply. Scale everything to it: script words (the template's script stats at that runtime), facts, sections, music cues, review rounds (one for a minute, two for a full episode); never pad or trim to reach the series' runtime instead.
- Everything else REMIX.md §0 asks (chapters, language) takes REMIX.md's default; write each one, and the length, with why, in the project's `CLAUDE.md`.

## 4. Facts and script, then stop 1

- Facts first, per REMIX.md: every number, date and quote with its source. A research sub-agent is fine.
- Write the script to voice.md and the series' script anatomy; run the script checks REMIX.md names.
- **Stop 1:** pose the script and the shot plan as stills on the board, written as the hyperframes skill's `references/storyboard.md` says: one still per beat, its line under it, what each shot shows and which component makes it. Point the person to `boards/storyboard.html` and wait for their go. Nothing paid before it.

## 5. Voice and face

- Voice: the person's voice id, through the kit's voice tool, as REMIX.md says. Then the kit's timing and pause tools. The voice is final before any presenter.
- **Audition before the whole script:** one paragraph (the kit's voice tool, as REMIX.md says), measure speech-only words a minute, and set the speed that lands on the series' rate. An instant clone takes no speed: change the words. Voice the script once; re-voice only the paragraphs that changed.
- Face (presented series): REMIX.md's host step, on the final voice: their own avatar, or HeyGen Video 1 from their photo. Their own takes: cut them per editing.md's presenter rules.
- A changed line after the presenter take exists means the whole take is made again, or the lips drift.

## 6. Footage, shot plan, build

- Find footage per footage.md, from the sources it names (Wikimedia Commons, Openverse, NARA, Library of Congress, Prelinger, Pexels, Mixkit, official media). Download with curl. One sub-agent per chapter is fine. Every file gets a licence line in the record REMIX.md names; credit what needs credit.
- Never take footage from YouTube, TikTok, Instagram or X unless its licence is stated.
- Write the shot plan and assemble with the kit's tools, as REMIX.md says. **Before any graphic, find the creator's precedent for that kind of moment in editing.md; with none, don't add it.** A component the template lacks: use the closest one and note it in GAPS.md.
- Keep `templates/` as pulled.

## 7. Checks, stop 2, render

- One heavy job at a time (renders, long ffmpeg, transcription): renders with `--workers 1`, ffmpeg with `-threads 2 -nostdin`. For a change, render only that window.
- Run REMIX.md's checks. Report each of our numbers beside the series' own: cuts a minute, pause density, longest hold, loudness, sound effects on picture changes, the script fingerprint. Name every check that failed.
- **Stop 2:** ask once on the draft: a contact sheet and `npx hyperframes preview`, with what is still a stand-in.
- Then the one full render REMIX.md's delivery calls for. A render over 10 minutes starts detached and is watched through its log, because a render stops when the shell that started it exits: `bash -c 'set -m; HYPERFRAMES_RENDER_DETACHED=1 npx hyperframes render -o <out> < /dev/null > render.log 2>&1 &'`.

## 8. Reply and hand back

- Say what the episode is, its length (and, for a short cut, that the full episode is one ask away), every stand-in, every check that failed and why, and the footage licence table. Update the project's `CLAUDE.md` with how it was made.
- Keep LOG.md (each step and how long, no prices or credit numbers) and GAPS.md (where the template was missing, unclear or wrong, with file and section) in the project root. GAPS.md is how the template gets better: never skip it.
