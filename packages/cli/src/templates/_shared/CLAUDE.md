# HyperFrames Composition Project

## Skills — USE THESE FIRST

**Always invoke the relevant skill before writing or modifying compositions.** Skills encode framework-specific patterns (e.g., `class="clip"`, `window.__timelines`, `data-*` attributes) that are NOT in generic web docs. Skipping them produces broken compositions.

| Skill                    | Command                 | When to use                                                                                            |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| **hyperframes-compose**  | `/hyperframes-compose`  | Creating or editing ANY HTML composition — videos, animations, title cards, overlays, sub-compositions |
| **hyperframes-captions** | `/hyperframes-captions` | Any text synced to audio: captions, subtitles, lyrics, karaoke. Also covers transcription strategy.    |
| **gsap-core**            | `/gsap-core`            | GSAP tweens: `gsap.to()`, `from()`, `fromTo()`, easing, stagger, defaults                              |
| **gsap-timeline**        | `/gsap-timeline`        | Timeline sequencing, position parameter, labels, nesting                                               |
| **gsap-performance**     | `/gsap-performance`     | Animation performance — transforms over layout props, will-change, batching                            |

> **Skills not available?** Ask the user to run `npx hyperframes skills` and restart their
> agent session, or install manually: `npx skills add heygen-com/hyperframes` and
> `npx skills add greensock/gsap-skills`.

## Commands

```bash
npx hyperframes preview          # preview in browser (studio editor)
npx hyperframes render       # render to MP4
npx hyperframes lint         # validate compositions (errors + warnings)
npx hyperframes lint --verbose  # include info-level findings
npx hyperframes lint --json     # machine-readable output for CI
npx hyperframes docs <topic> # reference docs in terminal
```

## Documentation

**For quick reference**, use the local CLI docs command (no network required):

```bash
npx hyperframes docs <topic>
```

Topics: `data-attributes`, `gsap`, `compositions`, `rendering`, `templates`, `troubleshooting`

**For full documentation**, discover pages via the machine-readable index — do NOT guess URLs:

```
https://hyperframes.heygen.com/llms.txt
```

## Project Structure

- `index.html` — main composition (root timeline)
- `compositions/` — sub-compositions referenced via `data-composition-src`
- `meta.json` — project metadata (id, name)
- `transcript.json` — whisper word-level transcript (if generated)

## Linting — ALWAYS RUN AFTER CHANGES

After creating or editing any `.html` composition, **always** run the linter before considering the task complete:

```bash
npx hyperframes lint
```

Fix all errors before presenting the result. Warnings are informational and usually safe to ignore.

## Key Rules

1. Every timed element needs `data-start`, `data-duration`, and `data-track-index`
2. Elements with timing **MUST** have `class="clip"` — the framework uses this for visibility control
3. Timelines must be paused and registered on `window.__timelines`:
   ```js
   window.__timelines = window.__timelines || {};
   window.__timelines["composition-id"] = gsap.timeline({ paused: true });
   ```
4. Videos use `muted` with a separate `<audio>` element for the audio track
5. Sub-compositions use `data-composition-src="compositions/file.html"` to reference other HTML files
6. Only deterministic logic — no `Date.now()`, no `Math.random()`, no network fetches
