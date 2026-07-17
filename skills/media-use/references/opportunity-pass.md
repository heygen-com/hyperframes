# Be proactive — run a media opportunity pass

The human usually can't tell which media would lift the piece. You can. When you build or review a composition, do **one** grounded scan and then **ask once** — don't silently add, and don't nag per asset.

Surface an opportunity only when a concrete signal is present:

| Signal detected                                        | Offer                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| On-screen text / a script with no voiceover            | TTS voiceover (audio engine)                                                                |
| Emoji or a `<div>` styled as an icon                   | resolve real `icon`s                                                                        |
| Image that is a placeholder, tiny, or upscaled-looking | a better `image` (and/or upscale — see `references/operations.md`)                          |
| Hard scene cuts / transitions with no sound            | transition `sfx`                                                                            |
| A piece over ~10s with no music bed                    | `bgm`                                                                                       |
| Footage that reads under/over-exposed or color-cast    | a corrective `grade` (analyze with `grade --for`, preview with `hyperframes grade-compare`) |

Rules that keep this a help, not nagware:

- **Grounded, not generic.** No signal → no suggestion. Never open with "want better images?".
- **Opinionated + concrete.** Propose the specific fix ("add a VO from your script, swap 3 emoji for real icons, replace the 400×400 hero, whooshes on the 4 cuts"), with defaults chosen — the human just approves **all / some / none**.
- **Once per project.** One consolidated ask, top few highest-value items. Respect "leave it" and don't re-raise.
- **Surface, never silently mutate.** Color grades especially: propose and preview, never auto-apply — a gray-world "correction" ruins an intentional sunset or neon look.
