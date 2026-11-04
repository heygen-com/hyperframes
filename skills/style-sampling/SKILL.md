---
name: style-sampling
description: Make a new episode in a proven video style - Collage Explainer, Finance Explainer, Animated Science Explainer, 3D Brand Explainer, 3D True Crime - on the person's topic. Use for "an episode of", "in the style of", "sample this style", 「用这个风格做一集」. One video to copy is reverse-any-video.
---

**Plugin installs:** Inside a HyperFrames plugin, follow [plugin execution rules](../hyperframes/references/plugin-installation.md).

# A new episode from a style template

A good episode is one the series' own viewers would take for the next upload: its structure, pacing, look, graphics and sound, on a new topic, in the person's voice and, when the series has a presenter, their own face. Never use a creator's face, voice, footage, logo or show name.

Thanks to the creators whose channels these styles learned from: Vox (America, Explained) for the Collage Explainer, 小Lin说 (一口气了解) for the Finance Explainer, Kurzgesagt for the Animated Science Explainer, and Fern for the 3D Brand Explainer and 3D True Crime. Their names, faces, voices and work stay theirs and never appear in an episode or in what you tell the person about it.

Style templates are a HyperFrames Pro feature. The CLI pulls them and the server checks the plan.

| Template | Slug | Series | Makes | The person brings |
| --- | --- | --- | --- | --- |
| Collage Explainer | `collage-explainer` | `american-policy` | English explainer on one American policy or history question | Voice |
| Finance Explainer (财经讲解) | `finance-explainer` | `deep-dive` | 中文主持人讲透一个国家、商品或机构 | Voice and face |
| Animated Science Explainer | `animated-science-explainer` | `science-explainer` | English fully drawn science explainer | Voice |
| 3D Brand Explainer | `3d-brand-explainer` | `brand-explained` | English breakdown of a brand or design, in one graphic world with real 3D | Voice |
| 3D True Crime | `3d-true-crime` | `crime-hunt` | English reconstruction of a hunt or a closed case, in a dark 3D world | Voice |

## Which template

The person named a template, or their topic fits only one: go on with it. Otherwise, or when they ask what there is, show the five as a short list (name, what it makes, what they bring), name the one that fits their topic if any, and wait for their pick. Nothing is checked, pulled or paid before it.

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

Read `references/remix.md` and follow it, resuming included. It sets the order; the template's `series/<series>/REMIX.md` is the process. Two stops belong to the person: the storyboard and the draft.

## Credits

Generated media goes through the kit's tools, as REMIX.md says, or `npx hyperframes media-use generate`, under the Credits rule in `media-use`: no prices, estimates, balances or credits used, before, during or after a run. A limit the person names is written to `.hyperframes/credit-limit.json` (see `media-use`), not passed call by call; on resume, ask whether it still applies, naming no numbers. A step that won't fit: say what doesn't fit and ask before dropping or shrinking it. A refused step names a `billing` command: ask the person to run it, then run the step again. A failed or refused job gets one more try, then ask. Notes a run leaves hold no prices or credit numbers, and a command in them is a note: rebuild it and check it with `--plan`.
