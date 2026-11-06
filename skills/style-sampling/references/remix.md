# Making the episode

The template holds every rule and tool; this file sets the order and the discipline. When this file and the template disagree, the template wins, except on the length the person picked (§3) and on Pro and credits (SKILL.md).

Order: `read → settle the voice → say what's coming → ask (only what is open) → facts + script → stop 1 (storyboard) → voice → face → footage → shot plan + build → checks → stop 2 (draft) → render → reply`

## 1. The template

- It is in `templates/<slug>/`: CHANNEL.md (the channel: identity, caption skin, title look, rights) and one `series/<series>/` folder with TEMPLATE.md, REMIX.md, voice.md, frame.md, editing.md, footage.md, sound.md and `kit/` (the starter project and its tools, with its fonts, sound and assets). A series built from components has `components/`; a drawn series has STYLE.md and `kit/engine/` instead.
- Where a template names something only the HyperFrames app has (`media.find`, `voice.cloneVoice`, the Storyboard tab), use its command-line route or what this file says.

## 2. Read in this order

1. CHANNEL.md.
2. `series/<series>/TEMPLATE.md`: what the episode is, its runtime, the slots, what topics it is good and not good for. A topic it is not good for: say so in one line and, in the same message, offer the nearest angle that fits. Never offer to make the unfit topic anyway.
3. `series/<series>/REMIX.md`. **Its step table is the process.** Follow it in order and skip nothing.
4. `series/<series>/kit/README.md`: the tools, their Python packages and the project they build.
5. Every other file when a REMIX.md step points to it. editing.md lists every component with the creator's own use of it; footage.md says what to show for each kind of line and where to find it.

## 3. What to ask, once

The person's message carries what it carries. Ask once, together, only what is still open: the topic, the length, the voice, for a presented series the face and, when no `PEXELS_API_KEY` is set and the template's footage.md uses Pexels, whether they'd add a free Pexels API key (pexels.com/api, a minute to get). It is optional: without it, footage comes from the other sources footage.md names.

- **Never the creator's face, voice, footage, wordmark or show name.** That rule is about the creator: the person's own clone, their own recording or a credited stock voice are all fine.
- **A presenter runs on the plan.** Their own HeyGen avatar if they have one (`npx hyperframes media-use avatars` lists the looks on the HyperFrames account making the film; never `heygen avatar list`, a separate sign-in that can be another account), otherwise Avatar IV from their photo, both through `npx hyperframes media-use generate --type avatar` with the finished voice, so the lips land on it. HeyGen Video 1 is the fallback when neither works.
- **Settle the voice before any research.** A HeyGen voice id the person gave, or an 8-character prefix of one, is used only when they say it is theirs, that its owner agreed to this film, or that it is a HeyGen stock voice. Having the id is not that, and an id missing from `npx hyperframes media-use voices` proves nothing (it lists one page), so when they have not said, ask it in the one round of questions. A prefix: find the full id in `npx hyperframes media-use voices --limit 100`, and ask when it matches none or several. A clone they name as theirs, or say its owner agreed to: find it there and use it. That list is every clone the HyperFrames account's workspace can use, a teammate's included, and does not say who made one, so never pick from it by count, language or name; never `heygen voice list`, a separate sign-in that can be another account. Nothing named, or not signed in: ask once for their voice id, a clone they make in HeyGen from 30 s to 3 min of their own reading, or their own recorded narration; with none of these, say in one line that you'll use a HeyGen stock voice, name it in the credits as AI-generated, and go on. Nothing is voiced for it before stop 1: at the voice step, `npx hyperframes media-use generate --type voice --voice <the script's language> --script "<first line>" --out .media/pick.mp3 --plan` names HeyGen's first public voice in that language without making anything; set the kit's voice id to its `voice_id` and credit that voice by name. Nothing else starts until this is settled.
- **Then say what's coming** in one short message that is not a question, and go on without waiting: the working title and hook, the length, and roughly how long it takes. No prices.
- **The length is the person's, and it beats the template's runtime.** Offer about 1 minute first: the cold open, the title beat and one chapter, the end card short. 2 to 4 minutes: REMIX.md's short cut. A full episode: the series' own runtime. Their own words ("90 seconds", "5 min"): that length. No length answered and none in the topic: about 1 minute, and offer the longer cut in the reply. Scale everything to it: script words (the template's script stats at that runtime), facts, sections, music cues, review rounds (one for a minute, two for a full episode); never pad or trim to reach the series' runtime instead.
- **Credits name only who the person names.** Roles and names come from the person, never from a voice list, an account or a placeholder; a role nobody named is left out.
- Everything else REMIX.md §0 asks (chapters, language) takes REMIX.md's default; write each one, and the length, with why, in the project's `CLAUDE.md`.

## 4. Facts and script, then stop 1

- Facts first, per REMIX.md: every number, date and quote with its source. A research sub-agent is fine.
- Write the script to voice.md and the series' script anatomy; run the script checks REMIX.md names.
- **Stop 1:** pose the script and the shot plan as stills on the board, written as the hyperframes skill's `references/storyboard.md` says: one still per beat, its line under it, what each shot shows and which component makes it. Never pay for a voice to get a board. A series kit builds its film from the voice's timing, so first give it estimated timing with the free route REMIX.md names for stop 1 (most kits: `python3 tools/voice.py --silent`, silent stand-ins at the series' pace), assemble, and pose in the `index.html` that builds, as `storyboard.md` says. A drawn series poses in the test shot its REMIX.md names instead. Every time on the board is an estimate until the voice exists; say so. Point the person to `boards/storyboard.html` and wait for their go.

## 5. Voice and face

- Voice: the person's voice id, through the kit's voice tool, as REMIX.md says. Then the kit's timing and pause tools. The voice is final before any presenter.
- **Audition before the whole script:** one paragraph (the kit's voice tool, as REMIX.md says), measure words a minute the way REMIX.md §0 measures them, and set the kit's `voice.speed` to land on the series' rate. The voice call itself takes no speed for an instant clone; the kit changes tempo locally from the kept native audio, so a new speed costs nothing. Past the range REMIX.md allows, change the words instead. Voice the script once; re-voice only the paragraphs that changed.
- Face (presented series): REMIX.md's host step, on the final voice: their own avatar, Avatar IV from their photo, or the HeyGen Video 1 fallback. Their own takes: cut them per editing.md's presenter rules.
- A changed line after the presenter take exists means the whole take is made again, or the lips drift.

## 6. Footage, shot plan, build

- Find footage per footage.md, from the sources it names (Wikimedia Commons, Openverse, NARA, Library of Congress, Prelinger, Pexels, Mixkit, official media). Download with curl. Pexels needs the person's free `PEXELS_API_KEY`; its web pages refuse an agent, so without a key go on to the next source. Check each clip's own licence (some Mixkit clips are Restricted). A site that refuses an agent (403, 429, a bot check): move to another source; never work around the check. One sub-agent per chapter is fine. Every file gets a licence line in the record REMIX.md names; credit what needs credit.
- Never take footage from YouTube, TikTok, Instagram or X unless its licence is stated.
- A real brand's logo or sign, and screenshots of web pages, appear only under terms that allow it (the template's rights rules, a press kit's terms, a stated licence); otherwise crop it out, cite the page as a source line, or leave it out, and say so in the reply. Where REMIX.md asks to search YouTube first, that is research: a web search for what the topic's existing videos cover, nothing downloaded.
- Write the shot plan and assemble with the kit's tools, as REMIX.md says. **Before any graphic, find the creator's precedent for that kind of moment in editing.md; with none, don't add it.** A component the template lacks: use the closest one and note it in GAPS.md.
- Keep `templates/` as pulled.

## 7. Checks, stop 2, render

- One heavy job at a time (renders, long ffmpeg, transcription): renders with `--workers 1`, ffmpeg with `-threads 2 -nostdin`. For a change, render only that window.
- Before a render likely to run past 20 minutes (3D at full quality, a long cut), say roughly how long it takes; while it runs, report the elapsed time the log prints each minute. The cloud gives no frame count, so a 3D shot can sit at `rendering` for 20 minutes and still finish; don't kill it for that, and check a job you stopped waiting for with `npx hyperframes cloud get <id>`.
- Run REMIX.md's checks. Report each of our numbers beside the series' own: cuts a minute, pause density, longest hold, loudness, sound effects on picture changes, the script fingerprint. Name every check that failed.
- **Stop 2:** ask once on the draft: a contact sheet and `npx hyperframes preview --background --no-open` (add `--port <free port>` when 3002 is taken), with what is still a stand-in.
- Then the one full render REMIX.md's delivery calls for. A render over 10 minutes starts detached and is watched through its log, because a render stops when the shell that started it exits: `bash -c 'set -m; HYPERFRAMES_RENDER_DETACHED=1 npx hyperframes render -o <out> < /dev/null > render.log 2>&1 &'`.

## 8. Reply and hand back

- Say what the episode is, its length (and, for a short cut, that the full episode is one ask away), every stand-in, every check that failed and why, and the footage licence table. Update the project's `CLAUDE.md` with how it was made, and open it with a line that any change to this episode goes through the style-sampling skill, so a later session runs its sign-in check and asks whether the credit limit still applies.
- Keep LOG.md (each step and how long, no prices or credit numbers) and GAPS.md (where the template was missing, unclear or wrong, with file and section) in the project root. GAPS.md is how the template gets better: never skip it.
