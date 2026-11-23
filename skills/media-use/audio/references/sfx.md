# Sound effects (SFX)

Named sound effects, produced by the shared audio engine (`scripts/audio.mjs` → `scripts/lib/sfx.mjs`). No account or key is needed:

- **Openverse first, per cue.** Each cue is searched on [Openverse](https://openverse.org)'s free audio API (most sound effects come from Freesound). Search-and-download, **not** generation.
- **The bundled 21-file library is the fallback** (`assets/sfx/` + `manifest.json`): a cue Openverse has no usable match for, and every cue once Openverse is offline or rate limited, is matched against it and the file copied into the project.

There is no `npx hyperframes sfx` command. SFX is never generated — it is retrieved from Openverse (online) or taken from the bundled library (offline). `npx hyperframes media-use resolve --type sfx` follows the same order (`--local-only` skips Openverse).

## Licences

Only **CC0** and **CC BY** sounds are used: never NonCommercial, ShareAlike or NoDerivatives. Each CC BY sound is credited in the project's `assets/sfx/CREDITS.md` (title, creator, licence, source link; for `resolve`, in a `CREDITS.md` beside the sound files it saves) and its `audio_meta.sfx[]` entry carries `license` and `credit`. Tell the person to include those credits wherever the video is published.

## Cues — request → meta

Each line names the effects it wants: `lines[].sfx: ["whoosh", "ui click"]`. The engine flattens these into cues, resolves each, dedupes identical `(id, name)` pairs (the same effect named twice downloads/copies once), and writes `audio_meta.sfx[]`:

```jsonc
{
  "id": "3",                       // joins the cue to the caller's model (frame / scene / segment)
  "name": "whoosh",
  "file": "assets/sfx/whoosh.mp3", // downloaded or copied, relative to project root
  "source": "openverse" | "local", // which route resolved it
  "offset_s": 0,                   // delay from the line's start
  "duration_s": 0.57,
  "volume": 0.35,                  // SFX sit UNDER voice + BGM
  "license": "by",                 // Openverse only: "cc0" or "by"
  "credit": "\"Swoosh\" by Ana is licensed under CC BY 4.0. …" // Openverse only
}
```

A cue that matches nothing is **skipped** (recorded as an anomaly); SFX never blocks a render. Neither route replaces a file of yours already at the output name: the cue gets the next free name (`whoosh-2.mp3`), reported as an anomaly, and `file` carries the real path.

## Openverse

One search per distinct effect name (20 results, `license=cc0,by`; each result's licence is checked again). The pick keeps Openverse's relevance order, prefers clips that fit a cue (15 s at most; past ~4 s ranks lower) and CC0 over CC BY when they are close. The file lands at `assets/sfx/<slug>.<ext>` and `duration_s` comes from the result. Name effects concretely (`glass shatter`, not `dramatic sound`); a vague query returns a poor match. Anonymous use allows 20 searches a minute and 200 a day: past that, the rest of the run uses the bundled library.

## Bundled library (fallback)

21 curated files in `assets/sfx/`, indexed by `manifest.json` — `{ file, duration, description }` per key (e.g. `whoosh`, `pop`, `click`, `chime`, `riser`, `impact-bass-1`, `glitch-1`, `typing`, …). A cue name resolves by **manifest key, file basename, or slug**, so `whoosh`, `whoosh.mp3`, or `"ui click"` (→ slug) all match. Matched files are copied into the project's `assets/sfx/`; `duration_s` comes from the manifest, so timing is known **offline** — e.g. `riser` is 10.03s, so trigger it at `climax − 10.03s`. The manifest's `description` field carries placement hints per effect; read `assets/sfx/manifest.json` for the full set and usage.

## Rules

- **Volume ~0.35.** SFX must sit under narration and BGM, not fight them.
- **No match → skip, don't fail.** A missing effect logs an anomaly and moves on; never a render blocker.
- **Retrieval (Openverse) or bundled library (offline) — never generation.**
- **One asset per distinct name.** Reuse across lines is deduped to a single search and download, many cues.
- **Credit CC BY sounds.** `CREDITS.md` lists them; keep it with the project.
