# code-terminal-run

A token-chrome terminal panel runs one command. The prompt line types itself
deterministically behind an integer-cycle blinking caret (the typed-prompt
text-at-time law), the command executes after a beat, output lines print one
per cue with a leading beat, and a fresh prompt with a solid caret appears
once the run completes. Then the panel holds still.

5s authored, elastic HOLD, exit `none` by default.

## Files

- `code-terminal-run.html`: the mountable sub-composition (install target:
  `compositions/components/code-terminal-run.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: standalone 1920x1080 host that mounts the primitive with
  non-default variables.

## Variables

| id             | type   | default | notes                                                                     |
| -------------- | ------ | ------- | ------------------------------------------------------------------------- |
| `prompt_glyph` | string | `$`     | leading glyph on the command and trailing prompt; empty string hides it    |
| `cadence`      | enum   | `human` | `uniform` fixed steps or `human` seeded 1-3 char chunks (fixed LCG seed)   |
| `cues`         | string | ``      | comma seconds from mount start; cue N sets when output line N prints       |
| `accent`       | enum   | `green` | glyph + caret: `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`         | enum   | `none`  | `none` holds the final frame; `fade` and `up` release the stage            |

Envelope: panel settles over 0.5s, typing runs from 0.4s at its natural
cadence, an execute beat follows, output lines print (defaults: a 0.3s leading
beat after execute, then one line per 0.3s), and the trailing prompt lands.
The whole schedule compresses proportionally only if it would overflow
`duration - OUT`; HOLD is the sole elastic phase (never `timeScale`). The
`command-run` sync point marks the execute beat, about 3.1s at defaults.

## The slot mechanism

The primitive ships one named slot inside its `<template>`:

```html
<div class="ctr-slot" data-slot="content">
  <div data-terminal="command">...</div>
  <div data-terminal="output">...</div>
  ...
</div>
```

The default children are a generic build-tool sample (no product branding).
To show your own run, install the component and **replace the children of the
`[data-slot="content"]` element in your installed copy** (the runtime clones
only the primitive's own template on mount, so slot content lives in the
component file, not on the host clip).

Rules:

- Keep exactly one `[data-terminal="command"]` element. Its full text is what
  gets typed; the caret is appended automatically.
- Add any number of `[data-terminal="output"]` elements, in print order. Each
  prints on its cue (or on the authored rhythm when `cues` is empty).
- Token coloring is authored, not parsed: wrap substrings in spans with these
  classes and each routes to one contract token.

| class      | token        | use for                        |
| ---------- | ------------ | ------------------------------ |
| `ct-str`   | `--brand`    | quoted strings                 |
| `ct-flag`  | `--accent`   | flags and options              |
| `ct-path`  | `--accent-2` | file paths and targets         |
| `ct-ok`    | `--brand`    | success markers in output      |
| `ct-muted` | `--muted`    | dim annotations (sizes, times) |

Typing reveals characters across the command's text nodes in document order,
so the spans keep their colors mid-word and every seek direction renders the
same colored string for the same time.

## Worked example

Install, then author your own run:

```bash
npx hyperframes add code-terminal-run
```

In `compositions/components/code-terminal-run.html`, replace the slot
children:

```html
<div class="ctr-slot" data-slot="content">
  <div data-terminal="command">deploy <span class="ct-path">./site</span> <span class="ct-flag">--region</span> <span class="ct-str">"eu-west"</span></div>
  <div data-terminal="output"><span class="ct-muted">-</span> uploading 14 files</div>
  <div data-terminal="output"><span class="ct-ok">ok</span> live in 900 ms</div>
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="code-terminal-run"
  data-composition-src="./components/code-terminal-run.html"
  data-variable-values='{"prompt_glyph":">","cues":"2.6,3.1","accent":"blue"}'
  data-start="2"
  data-duration="5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host
clip gives it. Timeline registers under the literal `code-terminal-run` key.

## Notes

- Deterministic: fixed LCG seed `0x51ec0ded`, one chars-at-time row table
  built before the timeline registers; nothing is incremental.
- Output lines occupy layout from mount (they print via opacity), so the
  panel never reflows mid-run.
- The hold is a finite drift cycle followed by authored stillness, never a
  repeating tween.
