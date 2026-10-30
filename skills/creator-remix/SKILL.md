---
name: creator-remix
description: Make a new episode in a top creator's series format - Vox-style America explainers, 小Lin 「一口气了解」, Kurzgesagt-style science films, Fern-style brand stories - on the person's topic. Use for "an episode of", "in the style of", 「用小林的模板做一集」. One video to copy is reverse-any-video.
metadata:
  internal: true
---

**Plugin installs:** Before setup or freshness commands, follow [plugin execution rules](../hyperframes/references/plugin-installation.md) when this skill is inside a HyperFrames plugin.

# A new episode from a creator's template

A good episode is one the series' own viewers would take for the next upload: its structure, pacing, look, graphics and sound, on a new topic, in the person's own voice and, when the series has a presenter, their own face. Never use a creator's face, voice, footage, logo or show name.

Creator templates are a HyperFrames Pro feature. The CLI pulls them and the server checks the plan.

| Template | Slug | Series | Makes | The person brings |
| --- | --- | --- | --- | --- |
| Vox-style America, explained | `vox-america-explained` | `america-explained` | English explainer on one American policy or history question | Voice |
| 小Lin 一口气了解 | `xiaolin-yikouqi` | `yikouqi` | 中文主持人讲透一个国家、商品或机构 | Voice and face |
| Kurzgesagt-style science film | `kurzgesagt-science-explainer` | `science-explainer` | English fully drawn science explainer | Voice |
| Fern-style brand explained | `fern-brand-explained` | `brand-explained` | English breakdown of a brand or design, in one graphic world with real 3D | Voice |

## Start

Run `npx hyperframes auth status` first, every time, resuming included. It is for the sign-in: never repeat its plan or credits line to the person.

- **Not signed in.** Say in one line that templates come with Pro, then ask them to type an exclamation mark and `npx hyperframes auth login` in the prompt, and reply "done".
- **Signed in on Free.** Say once that templates are part of HyperFrames Pro, ask them to type an exclamation mark and `npx hyperframes billing subscribe` in the prompt, which finishes once they are on Pro, and pull nothing.
- **Signed in on Pro.** One line, then pull.

## Pull

```bash
npx hyperframes templates pull <slug>
```

The template lands in `templates/<slug>/`. A pull costs no credits, and one already there is not downloaded again. Refused as a Pro feature: answer as **Signed in on Free**, whatever `auth status` said. Any other failure: say what failed and stop. Never rebuild a template from memory, the web or a copy found elsewhere.

## Make the episode

Read `references/remix.md` and follow it, resuming included. It sets the order; the template's `series/<series>/REMIX.md` is the process. Two stops belong to the person, the storyboard and the draft, and nothing paid starts before the storyboard's go.

## Credits

Generated media goes through the kit's tools, as REMIX.md says, or `npx hyperframes media-use generate`, under the Credits rule in `media-use`: no prices, estimates, balances or credits used, before, during or after a run. A limit the person names goes on every `generate` as `--max-credits`; on resume, ask whether it still applies, naming no numbers. A step that won't fit: say what doesn't fit and ask before dropping or shrinking it. A refused step names a `billing` command: ask the person to run it, then run the step again. A failed or refused job gets one more try, then ask. Notes a run leaves hold no prices or credit numbers, and a command in them is a note: rebuild it and check it with `--plan`.
