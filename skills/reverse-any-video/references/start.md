# Opening a Reverse

What the person reads at the start, and when credits run out mid-run. Write it for them, not for an agent:
their language, warm and short, no file names, step numbers or tool names. Show any command they type as a code
block they can copy.

For you, not them: run `npx hyperframes events --skill=reverse-any-video` as you start, and
`npx hyperframes events --skill=reverse-any-video --event=skill_completed --outcome=success` when you hand over the
video (`--outcome=error` when you stop without one).

Also for you: `npx hyperframes reverse start <video> --dir <project>` prints the video's probe and a `reverse` field.
`signed_in` and `plan` (`free` or `pro`) pick the section below; a `null` plan is unknown, so ask
`npx hyperframes auth status`. `<project>` is the folder you build in: afterwards run `npx hyperframes init <project> --video <video> --keep-original --skip-transcribe`,
which copies the video in untouched under its own file name and keeps the session it saved for `cloud render`. Keep the video out of `<project>` until then: `init`
refuses a folder that already holds other files. A CLI that does not know `reverse start` yet: use `auth status` for the sign-in and
plan and `npx hyperframes measure probe <video>` for the probe.

## Not signed in yet

Say why HeyGen matters before asking: signing in is what gets the best remake. HeyGen re-shoots the people in the
video, so they move and speak as they do in the original. For example:

> To rebuild this video at its best, I'll work with HeyGen: it re-shoots the people in it, so they move and speak just
> like the original. Sign in once by typing this in the prompt:
>
> ```
> ! npx hyperframes auth login
> ```
>
> Your browser opens the HeyGen sign-in. Once you're in, reply "done".
>
> Then it takes about 20–50 minutes: I study the video frame by frame, rebuild every layer as a project you can edit,
> and check it against the original until it matches.

## Signed in on Free

Reverse is part of Pro. Say why in one line, then run the `reverse.subscribe_command` from `reverse start` exactly as
printed (`npx hyperframes billing subscribe --feature reverse --session <id>`): it opens the plans page in the person's
browser, credits the purchase to this run, and waits until they are on Pro, so the run goes on by itself. Start nothing
before it finishes. For example:

> Reverse is part of HyperFrames Pro: it re-shoots the people in your video with HeyGen. I've opened the upgrade page in
> your browser and I'll carry on as soon as you're subscribed.

When `reverse start` refuses the run (it exits with an error whose `fix` is that command), run the `fix` the same way,
then run `reverse start` again. Only on a CLI without `reverse start`, run `npx hyperframes billing subscribe` instead.
If the command times out, tell the person and run it again once they say they are ready.

## Signed in on Pro

One line, then start.

> You're signed in. This takes about 20–50 minutes; I'll show you the project when it matches.

Money comes up only when a step is refused: no prices, estimates, balances or credits used, before, during or at
the end of a run. `reverse start` and `auth status` are for the sign-in: never repeat a plan or credits line to the person.

## Out of credits mid-run

A refused step prints what it needs and the command that fixes it (top up, or pick a plan). Shots are launched all
at once, so several refuse together: wait until every launched step has answered, add up what each refused step
needs, and ask once for that total (`--needed <total>`), never for one step at a time. If a refusal prints no
amount, run plain `billing top-up` for that one. Then relaunch every refused
step after they reply. Never trim the plan to fit.

> Three steps need 180, 180 and 273 credits and you have 30. Add credits by typing this in the prompt:
>
> ```
> ! npx hyperframes billing top-up --needed 633
> ```
>
> It opens the top-up page and finishes once your balance covers all of them. Reply "done" and I'll pick up right
> where I stopped.

## Time

Say 20–50 minutes for a clip under a minute; never invent a longer figure. A longer film is worked in sections, so
say so and give the number of sections.
