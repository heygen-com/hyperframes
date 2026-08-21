# media-use usage dashboard

Reproducible definition of the media-use usage dashboard. The dashboard answers
"how much is media-use used, for what, is reuse working, and what can't it
satisfy" from the telemetry `scripts/lib/telemetry.mjs` already emits. Build it
in an authorized HyperFrames analytics project; this doc is the source of truth
so it can be recreated. Local complement: `resolve --stats` (same questions,
from `.media/` + `~/.media`, no dashboard access needed).

## Identity (see `scripts/lib/telemetry.mjs`)

Events attribute to the **same person as the hyperframes CLI and studio**
— the shared install id in `~/.hyperframes/config.json` (`anonymousId`), stitched
to the HeyGen account (`$identify`, `distinct_id` = email/username) on sign-in.
Not fully anonymous by design; pseudonymous before sign-in, account-linked after.
`$ip:null`. Opt-out: `HYPERFRAMES_NO_TELEMETRY=1` / `DO_NOT_TRACK=1` (also CI, dev).

## Event catalog (verified present in-project)

Every event carries `surface: "media-use"`. Event **properties are coarse** —
never intent text, file names, or paths.

| Event                                                                  | Fires on                                  | Key properties                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `media_use_resolve`                                                    | a resolve that produced/returned an asset | `type`, `source`, `provider`, `via`, `local_only`, `provider_override` |
| `media_use_resolve_miss`                                               | a resolve that found nothing              | `type`, `local_only`, `provider_override` (no intent)                  |
| `media_use_candidates`                                                 | `--candidates` / `--dry-run` listing      | `type`, counts                                                         |
| `media_use_doctor_run`                                                 | `--doctor`                                | `ok`, `checks_failed`, `failed[]`                                      |
| `media_use_compare`                                                    | `grade-compare` / `compare`               | `command`, `cells`, `truncated`, `total`, `render_ready_timed_out`     |
| `media_use_transcribe` · `media_use_duck` · `media_use_transcript_cut` | audio-engine ops                          | op-specific                                                            |

## Dashboard tiles

1. **Invocation volume** — `query-trends`, count of `media_use_resolve` over time (daily). "How much."
2. **By media type** — `media_use_resolve` broken down by `type` (bgm/sfx/image/icon/logo/voice/grade/lut). "For what."
3. **Resolve hit-rate** — trends formula: `A / (A + B)` where A = `media_use_resolve`, B = `media_use_resolve_miss`. "Is the catalog covering needs."
4. **Provider mix** — `media_use_resolve` broken down by `provider`; a second tile by `via` (`url` / `params-fallback` / `params`) to catch CDN→params LUT downgrades.
5. **Top misses** — `media_use_resolve_miss` broken down by `type` (the tuning signal — pair with local `resolve --stats`, which also shows the missed _intents_ that telemetry deliberately omits).
6. **Doctor health** — `media_use_doctor_run` broken down by `failed[]` (which dependency check fails most) + `checks_failed` distribution.
7. **Compare cost** — `media_use_compare` by `command`, plus `truncated` / `render_ready_timed_out` rates (observe before lifting the 16-cell cap).
8. **Adoption (optional)** — if the `first_run` property ships (plan U5), segment `media_use_resolve` first-run vs repeat.

## Recreate in an analytics dashboard

For each tile, confirm the event/property schema, build its trend or breakdown,
then add it to a dashboard. Keep names prefixed `media-use:` so the dashboard is
greppable. Cross-surface note: because identity is shared with CLI/studio, you
can also break these down by the same person across `cli_command*` and `studio:*`
events.
