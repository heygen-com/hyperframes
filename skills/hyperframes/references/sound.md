# Sound

Sound is half of how a film feels, and the viewer notices a silent one before any frame. Every judge of frames misses it, so plan it on purpose.

## 1. The default

- **A film over about 15 s that tells something** (launch, explainer, recap, PR video) gets a music bed and sounds on its visible actions, unless the person asked for silence or it is made to play muted (a looping background, a feed that autoplays without sound: then the type and the pictures carry it alone).
- **A voiceover** only when the request or the source calls for one (`SKILL.md`).
- **Each storyline says its sound** in one line (`story.md` §2): the bed's feel and tempo, the one moment the music changes, which actions get effects, or silence and why.
- **Short pieces** (a title card, a sting under 10 s, captions or overlays on footage that has its own sound) follow the request and the footage.

## 2. The clock

- **Narrated**: the voice is the clock. Time each beat's start to its anchor word; text lands on the word that says it.
- **Music only**: the music is the clock. Land the payoff and the mark on its strong beats (`npx hyperframes beats`, then `film.md` "On music"); cuts follow the motion, not the drums.
- Let the sound act out the story when it fits: the old way sits near silence, the music opens when the product appears; the music holds back until the payoff.

## 3. Music

The person's own track first, as given. Else search the catalog (`/media-use`, `bgm`) with the film's feel and tempo, not its subject ("tense minimal pulse building to a bright drop, 120 bpm"), and read a few results before keeping one. Enter at the track's strongest bar, not a quiet intro; end on a bar line with a short fade under the end card.

With no music source (no `heygen` sign-in and no local model), deliver silent and say so in one line with how to add one. Do not spend the run building an audio chain or writing music in code: nobody can hear whether it is good.

## 4. Effects

Few and exact: every effect has a cause on screen, and too many read as a template.

| Sound             | Only on                                        |
| ----------------- | ---------------------------------------------- |
| click             | a real cursor click on screen                  |
| whoosh            | a scene cut, or a large card moving fast       |
| soft key tick     | text arriving letter by letter or line by line |
| pop               | a badge, chip or number landing                |
| riser into impact | the payoff or the mark, once in the film       |

- Place a clip so its peak lands one frame after its picture (light arrives before sound; a sound early feels wrong sooner than one late): `npx hyperframes audio <file> --json` reports where it hits, and most files peak after their start.
- Each hit sits 3-6 dB over the bed; a bed with most of its energy under 150 Hz plays as nothing on a phone speaker.
- Rotate two or three takes of a repeated sound; the same whoosh on every cut is the most common tell.
- Over strong music, a typing-heavy film can drop the clicks and keys. No synthesised tones, chimes or dings.

## 5. Levels

Music under a voice sits around 0.14 volume; nothing clips (AI audio often does). Keep each file's true peak at −1 dBTP or lower and the mix around −16 to −14 LUFS for social, `npx hyperframes normalize-audio` to match levels (`/media-use`). Check the rendered file with `npx hyperframes audio <video> --json`: sound present, hits where the picture hits, loudness in range. Say in the delivery note that it was measured, not heard (`review.md` §4).
