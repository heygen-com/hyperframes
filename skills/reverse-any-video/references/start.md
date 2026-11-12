# Opening a Reverse

What the person reads at the start, and when credits run out mid-run. Write it for them, not for an agent:
their language, warm and short, no file names, paths, step numbers or tool names, and never a link to or quote from
these instructions: the only links are pages they need to open. You run every command except `billing`, which
is theirs: any page they need goes in your message as a plain link they can click, sign-in in case the browser did not
open, upgrade and add-on credits for them to open and pay themselves.

For you, not them: run `npx hyperframes events --skill=reverse-any-video --event=skill_completed --outcome=success`
when you hand over the video (`--outcome=error` when you stop without one).

Also for you: `npx hyperframes reverse start <video> --dir <project>` prints the video's probe and a `reverse` field.
`signed_in` and `plan` (`free` or `pro`) pick the section below, and that plan is final. Only a `null` plan is unknown:
then ask `npx hyperframes auth status --json` and read its `hyperframes` field, never `user.subscription`, which is the HeyGen
app's plan and does not unlock Reverse. `<project>` is the folder you build in: afterwards run `npx hyperframes init <project> --video <video> --keep-original --skip-transcribe --skip-skills`,
which copies the video in untouched under its own file name and keeps the session it saved for `cloud render`. Keep the video out of `<project>` until then: `init`
refuses a folder that already holds other files. Outside a plugin, a CLI is an old install (often a global one, which
never updates itself when an agent runs it) shadowing the current release when it does not know `reverse start`, when
its `reverse start` output has `_meta.updateAvailable: true`, or when that output says `signed_in: false` with no
`reverse.next`. Then run `npx -y hyperframes@latest --version` once and run `reverse start` again and every later
command of this run as `npx -y hyperframes@<that version> <command>`, so the whole run uses one release. That `reverse start` names the out-of-date install in `reverse.next` with the line
to open your next message to the person with: say it.
Inside a plugin, its pinned CLI is the one that runs: if it does not know `reverse start`, stop before anything is paid
for, and tell the person in one line that the HyperFrames plugin needs updating to reverse a video.

## Not signed in yet

Every message that asks them to sign in, or gives them the link again, starts with why HeyGen matters: signing in is
what gets the best remake, and that is the whole why (never say a skill or instructions require it; if you stop to wait,
just say you are waiting for them to sign in). HeyGen re-shoots the people in the video, so they move and speak as they do in
the original. Keep that reason even when all you send is a link and a code. For example:

> To rebuild this video at its best, I'll work with HeyGen: it re-shoots the people in it, so they move and speak just
> like the original. Your HyperFrames account is your HeyGen account: sign in here <link> (code <code>), and I'll carry
> on as soon as you're in.
>
> Then it takes about 20–50 minutes: I study the video frame by frame, rebuild every layer as a project you can edit,
> and check it against the original until it matches.

Run the `reverse.login_command` that `reverse start` printed. `npx hyperframes auth login` opens the browser and returns
once they are signed in: run it in the same message and wait for it; when the browser does not open, it prints the
sign-in link: give it, with the reason. `npx hyperframes auth login --device` is what it prints where no browser can open
(a remote or headless terminal; plain `auth login` refuses there too): start it in the background, then send one
message with the reason, the link and the code, before you wait on anything: they cannot sign in until they see them. Never sign in with an API key to get past Pro: that signs in a HeyGen app account, which has no HyperFrames plan.

## Signed in on Free

Reverse is part of Pro. Upgrading is the person's to do: never run a `billing` command yourself. Say why in one line and
give them the `reverse.upgrade_url` as a link, and the `reverse.subscribe_command` exactly as printed
(`npx hyperframes billing subscribe --feature reverse --skill reverse-any-video --session <id>`) for them to run instead
if they prefer: either opens the plans page, where they see the price and decide. Start nothing until they say they are
on Pro, then run `reverse start` again. For example:

> Reverse is part of HyperFrames Pro: it re-shoots the people in your video with HeyGen. Upgrade here: <upgrade_url>
> (or run `<subscribe_command>`), then tell me and I'll carry on.

When `reverse start` refuses the run (it exits with an error whose `fix` is that command), do the same with its `fix`.
When `subscribe_command` and `upgrade_url` are `null` (or the refusal names no command), a plan can't be purchased right
now: say so plainly, give no link, and stop.

## Signed in on Pro

One line, then start.

> You're signed in. This takes about 20–50 minutes; I'll show you the project when it matches.

Billing comes up only when a step is refused. Don't volunteer prices, estimates, balances or credits used, before, during
or at the end of a run. `reverse start` and `auth status` are for the sign-in: don't repeat their plan or credits line.

## Out of credits mid-run

A refused step prints what it needs and the command that fixes it (buy add-on credits, or pick a plan). Buying is the
person's to do: never run a `billing` command yourself. Shots are launched all at once, so several refuse together: wait
until every launched step has answered, add up what each refused step needs, and give them `npx hyperframes billing add-credits --needed <total> --skill reverse-any-video` to run once for that total, never one step at a time, with the
refusal's `url` (on an older CLI, the link in its `fix`) as a link. If any refusal prints no amount, the total is unknown:
give plain `billing add-credits` once instead, for the whole run, never one per step. Either opens the add-on credits page, where they see the price. When they say their
balance is topped up, relaunch every refused step, keeping the plan whole.

> Three steps need 633 credits together and you have 30. Add credits here: <url> (or run
> `npx hyperframes billing add-credits --needed 633 --skill reverse-any-video`), then tell me and I'll pick up right where I stopped.

## Handing it over

They see the result, not file paths. Run the last diff with `--sbs` and open the side by side it writes (original |
yours), start `npx hyperframes preview` on the project, and say in one line that they can keep editing there; pass on
its Framey line as `/hyperframes` does. Then send `skill_completed`.

## Time

Say 20–50 minutes for a clip under a minute; never invent a longer figure. A longer film is worked in sections, so
say so and give the number of sections.
