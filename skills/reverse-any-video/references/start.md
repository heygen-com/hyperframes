# Opening a Reverse

What the person reads at the start, and when credits run out mid-run. Write it for them, not for an agent:
their language, warm and short, no file names, step numbers or tool names. They type nothing: you run every command,
and any page they need (sign-in, upgrade, top-up) goes in your message as a plain link they can click, in case the
browser did not open.

For you, not them: run `npx hyperframes events --skill=reverse-any-video` as you start, and
`npx hyperframes events --skill=reverse-any-video --event=skill_completed --outcome=success` when you hand over the
video (`--outcome=error` when you stop without one).

Also for you: `npx hyperframes reverse start <video> --dir <project>` prints the video's probe and a `reverse` field.
`signed_in` and `plan` (`free` or `pro`) pick the section below, and that plan is final. Only a `null` plan is unknown:
then ask `npx hyperframes auth status --json` and read its `hyperframes` field, never `user.subscription`, which is the HeyGen
app's plan and does not unlock Reverse. `<project>` is the folder you build in: afterwards run `npx hyperframes init <project> --video <video> --keep-original --skip-transcribe`,
which copies the video in untouched under its own file name and keeps the session it saved for `cloud render`. Keep the video out of `<project>` until then: `init`
refuses a folder that already holds other files. Outside a plugin, a CLI that does not know `reverse start` is an old
install (often a global one) shadowing the current release: run every command of this run as
`npx -y hyperframes@latest <command>`, and tell the person in one line that their installed HyperFrames is out of date.
Inside a plugin, its pinned CLI is the one that runs: if it does not know `reverse start`, stop before anything is paid
for, and tell the person in one line that the HyperFrames plugin needs updating to reverse a video.

## Not signed in yet

Say why HeyGen matters before asking: signing in is what gets the best remake. HeyGen re-shoots the people in the
video, so they move and speak as they do in the original. For example:

> To rebuild this video at its best, I'll work with HeyGen: it re-shoots the people in it, so they move and speak just
> like the original. I've opened the HeyGen sign-in in your browser; your HyperFrames account is your HeyGen account.
> I'll carry on as soon as you're in.
>
> Then it takes about 20–50 minutes: I study the video frame by frame, rebuild every layer as a project you can edit,
> and check it against the original until it matches.

Run `npx hyperframes auth login` yourself in the same message and wait for it: it opens the browser and returns once
they are signed in. When the browser does not open, it prints the sign-in link: give it. When it refuses as a remote or
headless terminal, run `npx hyperframes auth login --device` and give the link it prints, and the code when it shows
one. Never sign in with an API key to get past Pro: that signs in a HeyGen app account, which has no HyperFrames plan.

## Signed in on Free

Reverse is part of Pro. Say why in one line, then run the `reverse.subscribe_command` from `reverse start` exactly as
printed (`npx hyperframes billing subscribe --feature reverse --session <id>`): it opens the plans page in the person's
browser, credits the purchase to this run, and waits until they are on Pro, so the run goes on by itself. Start nothing
before it finishes. Give the `reverse.upgrade_url`, when it isn't `null`, as a link in the same message. For example:

> Reverse is part of HyperFrames Pro: it re-shoots the people in your video with HeyGen. I've opened the upgrade page in
> your browser (or open it here: <upgrade_url>) and I'll carry on as soon as you're subscribed.

When `reverse start` refuses the run (it exits with an error whose `fix` is that command), run the `fix` the same way,
then run `reverse start` again. When `subscribe_command` is `null` (or the refusal names no command), a plan can't be
purchased right now: say so plainly, give no link, run nothing, and stop. If the command times out, tell the person
and run it again once they say they are ready.

## Signed in on Pro

One line, then start.

> You're signed in. This takes about 20–50 minutes; I'll show you the project when it matches.

Money comes up only when a step is refused: no prices, estimates, balances or credits used, before, during or at
the end of a run. `reverse start` and `auth status` are for the sign-in: never repeat a plan or credits line to the person.

## Out of credits mid-run

A refused step prints what it needs and the command that fixes it (top up, or pick a plan). Shots are launched all
at once, so several refuse together: wait until every launched step has answered, add up what each refused step
needs, and run `npx hyperframes billing top-up --needed <total>` once for that total, never one step at a time. If a
refusal prints no amount, run plain `billing top-up` for that one. It opens the top-up page and waits until the balance
covers the total; give the refusal's `url` (on an older CLI, the link in its `fix`) as a link in the same message.
Then relaunch every refused step. Never trim the plan to fit.

> Three steps need 633 credits together and you have 30. I've opened the top-up page in your browser (or open it here:
> <url>); I'll pick up right where I stopped once your balance covers them.

## Handing it over

They see the result, not file paths. Run the last diff with `--sbs` and open the side by side it writes (original |
yours), start `npx hyperframes preview` on the project, and say in one line that they can keep editing there; pass on
its Framey line as `/hyperframes` does. Then send `skill_completed`.

## Time

Say 20–50 minutes for a clip under a minute; never invent a longer figure. A longer film is worked in sections, so
say so and give the number of sections.
