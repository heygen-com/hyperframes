# facet-morph

A faceted low-poly mass (36 triangles, one SVG) continuously reshapes between
three authored silhouettes (blob, mark, badge) with per-facet flat shading
that recomputes as the vertices move. Light reads from the upper left: facets
turned toward it lift toward a pale accent-tinted tone, facets turned away
fall toward near-black. One calm continuous morph in the quiet register, then
a settled hold (or a slow breath when `hold_last` is false).

Reference: the ordinaryfolk reshaping-mass beat (motion-reference
`ordinaryfolkco/2001090228958752945`, sheet 02).

## Files

- `facet-morph.html`: the mountable sub-composition (install target:
  `compositions/components/facet-morph.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a full-bleed 1920x1080 LIGHT host that mounts the primitive
  with non-default variables (QA gallery input).

## Variables

| id          | type    | default           | notes                                                                     |
| ----------- | ------- | ----------------- | ------------------------------------------------------------------------- |
| `forms`     | string  | `blob,mark,badge` | comma-separated silhouette sequence; valid names blob, mark, badge        |
| `hold_last` | boolean | `true`            | true settles dead still on the final form; false breathes through hold    |
| `accent`    | enum    | `green`           | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`      | enum    | `none`            | `none` holds the settled mass; `fade` and `up` release the stage          |

Envelope: IN = 0.55s entrance + one 1.45s morph leg per silhouette step
(0.35s dwell between legs) + 0.55s wobble decay; OUT = 0.45s only when `exit`
is `fade` or `up`; HOLD is the sole elastic phase. The `form-lock` sync point
(`hf:sfx` id `facet-settle-soft`) fires when the mass reaches its final
silhouette, 3.95s at the 3-form default.

## How it works (and how to restyle it)

- Vertex positions are authored keyframe tables (per-silhouette radius,
  jitter, and center rows over fixed angular spokes), interpolated as a pure
  function of timeline time by one linear driver tween. Forward, backward,
  and shuffled seeks land identical frames.
- Facet fills are computed in JS on every update and written as `fill` /
  `stroke` ATTRIBUTES with literal `rgb()` strings. Contract tokens
  (`--fg`, `--surface`, and the accent token) are resolved to concrete rgb
  once at mount, so a host theme restyles the mass without any var() color
  ever reaching a tween.
- The mass tone is fg-heavy (`--fg` mixed toward `--surface`), so it reads
  dark on light hosts and light on dark hosts, always contrasting `--bg`.
- To add a silhouette, add one row to the `FORMS` table in your installed
  copy (18 outer radii, 18 outer jitters, 9 inner radii, 9 inner jitters,
  center, rotation) and name it in `forms`.

## Worked example

```bash
npx hyperframes add facet-morph
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="facet-morph"
  data-composition-src="./components/facet-morph.html"
  data-variable-values='{"forms":"badge,blob,mark","hold_last":false,"accent":"violet"}'
  data-start="0"
  data-duration="5"
  data-track-index="0"
></div>
```

The mass enters over 0.55s, reshapes badge to blob to mark, and keeps a slow
breath between the last two silhouettes until the frame cuts (`exit`
defaults to `none`; frame roots own scene transitions).
