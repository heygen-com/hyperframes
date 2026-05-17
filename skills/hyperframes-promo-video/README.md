# hyperframes-promo-video

Generate an actual rendered `mp4` + poster image from a PR, feature, or product change — using [HyperFrames](https://hyperframes.dev) (HTML/CSS/GSAP-based video).

Same workflow shape as `remotion-video` and the same storytelling rules, but built on HyperFrames instead of React/Remotion. For people who'd rather author scenes in HTML/CSS than JSX. Iterates with `npx hyperframes preview`, then renders `video.mp4` + `poster.jpg`.

This skill produces a _video file_. If you want a textual script instead, use `video-script`.

## Companion skills (HyperFrames ecosystem)

This skill only carries the promo-video-from-PR logic — input resolution, narrative planning, motif derivation, hook enforcement, scene-plan auditing, render-time gates. The mechanics of the HyperFrames stack live in separate skills (install them for best results):

- **`hyperframes`** — composition authoring rules: DESIGN.md gate, Layout Before Animation, palettes, transitions, typography, motion principles, captions, audio, TTS
- **`hyperframes-cli`** — every `npx hyperframes <command>` (init, lint, preview, render, transcribe, tts, doctor, etc.)
- **`gsap`** — GSAP timeline patterns, easing, stagger, performance, position parameter, labels, nesting
- **`hyperframes-registry`** — registry blocks/components and `hyperframes add`

Without those installed, the skill still works but emits a warning that quality may be reduced.

## Inputs

In resolution order:

1. Path to a marketing brief (`.md` containing "Executive Summary" or "Key Messages")
2. Path to a blog post
3. Path to a changelog
4. GitHub PR URL or `#1234`
5. Git ref range — `v1.0...v2.0`
6. File or directory path
7. Freeform text

## Invoke

```
/hyperframes-promo-video #1234
/hyperframes-promo-video .tmp/marketing-brief.md
```

Or trigger by description:

> "Render a HyperFrames video for #1234."
> "Make a 30-second promo video using HyperFrames."

## Output

- `video.mp4` — the rendered video (default 30s, 16:9)
- `poster.jpg` — first-frame poster
- The HyperFrames project directory (HTML composition) for further hand-editing

Default location: `marketing/<feature-slug>/hyperframes/` or wherever `marketing-pipeline` directs shared output.

## How it works

Seven phases: discovery, configuration (duration, aspect ratio, project location, brand scanning), narrative planning (motif, hook, scene plan), scaffold the composition, first draft + iterate via `npx hyperframes preview` (freeform loop), render with pre-render audits, cleanup. Phases 1, 3, 5, and 7 have explicit approval gates.

### "Use sane defaults" mode

The skill recognizes phrases like _"use sane defaults"_, _"don't ask questions"_, _"non-interactive"_, _"just ship it"_ and skips the configuration prompts (defaults to 30s / 16:9 / `marketing/<slug>/hyperframes/`).

But it does **not** skip:

- Brand color/font/logo scanning — hardcoding from training-data assumptions is forbidden
- The `npx hyperframes preview` step — you must see the studio URL before render
- Phase 6 pre-render audits (storytelling, hook rules, motif presence, pacing variance, value-prop timing, contrast)
- The cleanup question

These exist to prevent shipping a generic video.

## Files

- [`SKILL.md`](./SKILL.md) — the skill itself
- [`brand-detection.md`](./brand-detection.md) — how the skill scans for brand assets
- [`patterns/`](./patterns) — reusable scene patterns
- [`templates/`](./templates) — starter compositions
- [`hooks/`](./hooks) — pre-render audit hooks
- [`references/`](./references) — supporting documentation

## Credits

Originally authored by [Alem Tuzlak (@AlemTuzlak)](https://github.com/AlemTuzlak) as `hyperframes-video`.
Integrated into the HyperFrames skill catalog with permission.
