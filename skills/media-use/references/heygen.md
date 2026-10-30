# HeyGen from the HyperFrames CLI

`media-use generate` and `transcribe --engine heygen` call HeyGen directly with the HyperFrames sign-in; they need no `heygen` CLI. Every paid call carries a key derived from what it asks, so running the same command again picks up the same job instead of paying twice (a failed or refused one is sent as a new job), and each job is logged in the project's `.hyperframes/heygen-jobs.jsonl`.

## Signing in

`npx hyperframes auth status` says what is signed in. The credential is read in this order: `HEYGEN_API_KEY`, `HYPERFRAMES_API_KEY`, a host app's `HEYGEN_ACCESS_TOKEN`, then `~/.hyperframes/credentials`, which `npx hyperframes auth login` writes. `heygen auth login` is a separate sign-in that only the `heygen` CLI reads.

| Credential                 | Pays with                                    | Covers                                                                                 |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| API key                    | API credits                                  | everything below                                                                       |
| Sign-in (OAuth)            | the plan's allowance on subscription credits | avatar videos, video shots, images and voices; music and transcription take an API key |
| Inside the HyperFrames app | the app                                      | whatever the app allows; nothing to set up                                             |

A refusal names its fix: `api_key_required` needs an API key, `402` or `insufficient_credit` needs a top-up, `hf_usage_exhausted` means the plan's allowance is used up.

## Making media: `media-use generate`

Make it without quoting a price or asking for a budget; `--plan` only prints what a call would cost (`credits` is an estimate in HyperFrames credits), for your own planning; never pass it on. When the person names a credit limit, keep under it with `--max-credits` (SKILL.md, Credits). Make a piece again only for a fault you can name (a cut inside it, text in it, the wrong framing), once, never to chase a motion or look score; a `content_policy_violation` gets one reworded try. A failed or refused job also gets one more try, test calls included; then stop and ask the person.

```bash
# a still, edited from a reference picture: a clean plate with the words removed
npx hyperframes media-use generate --type image --reference assets/frame.png --prompt "the same shot with no text or logos" --out assets/plate.png --plan
# a shot of 5–15 s, starting from a first frame; longer shots are shots chained from each one's last frame
npx hyperframes media-use generate --type video --first-frame assets/s03-first.png --prompt "slow push in" --seconds 8 --out assets/s03.mp4
# a person re-shot from a still over one shot of the original (never across a cut), saying that shot's voice with lips
# in sync and moving as the guide (the original shot itself) does; --mask x,y,w,h[,a-b] (repeatable, the guide's
# pixels and seconds) blanks text in the guide, which HeyGen would copy
npx hyperframes media-use generate --type video --reference assets/person.png --audio assets/s02-voice.m4a --motion assets/s02-original.mp4 --mask 110,615,390,165,0.4-2.0 --prompt "talks to camera, seated" --seconds 8 --aspect 9:16 --out assets/s02-person.mp4
# the same for a person who does not speak: no --audio, the guide clip carries the motion
npx hyperframes media-use generate --type video --reference assets/person.png --motion assets/s05-original.mp4 --prompt "holds up a jar, smiles" --seconds 6 --aspect 9:16 --out assets/s05-person.mp4
# a person in a photo speaking a script in a HeyGen voice
npx hyperframes media-use generate --type avatar --photo assets/person.png --script "…" --voice <voice-id> --out assets/person.mp4
# a voice reading text
npx hyperframes media-use generate --type voice --script "…" --voice <voice-id> --out assets/vo.mp3
# music, 30, 60, 120 or 180 s (instrumental unless --vocals), trimmed to length in the composition
npx hyperframes media-use generate --type music --prompt "warm lo-fi, soft keys" --seconds 30 --bpm 90 --out assets/music.mp3
```

The file lands at `--out` and the media ledger records it as generated, with the route, model, job, prompt and the files it was made from. Pictures and shots carry no text or logos: ask for clean plates and draw words in HyperFrames.

| Type   | Model                                                    | Price                                                                                                                                                                  |
| ------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| image  | nano-banana-2 (default), or gpt-image-2.5 with `--model` | $0.067 an image; gpt-image-2.5 $0.036–0.053 by aspect, plus $0.0082 a reference after the first                                                                        |
| video  | heygen-video-1, 768p                                     | $0.02 a second from a prompt or first frame; $0.05 a second with a reference picture, voice or guide clip, and the guide's seconds count too (1080p costs about twice) |
| avatar | talking photo                                            | $4.83 a minute of speech                                                                                                                                               |
| music  | lyria-3-pro                                              | $0.08 a track                                                                                                                                                          |
| voice  | the voice's engine                                       | charged per character, not priced ahead                                                                                                                                |

`--plan`'s `usd` is what an API key is charged (HeyGen rounds up to units of $1/60); its `credits` is what a HyperFrames plan charges, on the plan's own rates: a video shot's seconds and guide seconds, plus each picture past the first two. Voice ids come from `heygen voice list` or `npx hyperframes media-use resolve --type voice`; a cloned voice from `heygen voice clone create` (`operations.md`).

## Transcription: `transcribe --engine heygen`

```bash
npx hyperframes transcribe interview.mp4 --engine heygen --speakers
```

Word times from HeyGen's speech model, each word with its speaker under `--speakers`, in the same `transcript.json` local engines write. It takes an API key. The local engines (`--engine auto`) are free and good for one clear voice; HeyGen is the better choice for several speakers, noise or music under the voice.
