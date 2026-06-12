# PORTING — turning a cap_fx3 demo into a first-class theme DNA

One theme at a time. The demo is the spec; the engine is the law.

## Inputs

- Demo: `~/Downloads/cap_fx3/<tNN_name>/` — index.html (bg: scene-reaction + apex
  setpiece), rail.html (fg alpha: body + furniture + front fx), postfx.json,
  final_fx.mp4 + strip.png (ground truth of how it should look).
- Engine: `scripts/make-theme.cjs` — read the header + the existing paradigms
  (rail/panel/poem/takeover) and setpieces (detonation/decode/drawon/assembly/
  colorflip/cpslam/coverword/settle) before writing anything.

## Process

1. DECOMPOSE the demo: body paradigm? body entrance/exit verbs? hero setpiece?
   front fx? plate budget? linkages? Map each piece to an existing registry
   entry or mark it NEW.
2. EXTEND the engine for the NEW pieces only — port the demo's GSAP logic into
   generator functions, parameterized (sizes, colors, counts, seeds become DNA
   params). Registries stay generic: paradigms/setpieces are the unit of code,
   the DNA json is the unit of identity. Match the file's existing code style.
   `node --check scripts/make-theme.cjs` after every edit.
3. WRITE `themes/<name>.json` (drop the tNN\_ prefix). voice/when/register/fonts/
   palette/body/hero/fx/plate/linkages — follow anchor.json + ordnance.json shape.
4. VERIFY on the rooftop fixture:
   - scaffold: `mkdir ~/Downloads/port_<name>` + symlink source.mp4 / frames_fg /
     frames_bg + cp matte.fps transcript.json safe-zones.json from
     `~/Downloads/cap_multi/rooftop/` (frames_bg from `~/Downloads/cap_fx/_frames_bg`).
   - theme.json: same lines/hero the demo used (read its rail.html data).
   - `node scripts/make-theme.cjs <dir>` → `preview-frames.cjs <dir> <4 key times>`
     → READ the previews; compare against the demo's strip.png. Iterate ≤3 rounds.
   - full render: `bash scripts/render-theme.sh <dir>` → extract a 12-frame strip
     around the apex → view → compare to the demo strip. Small deviations OK,
     note them; the THEME must read identically at a glance.
5. REGRESSION: recompile one prior theme project (e.g. `~/Downloads/cap_anchor`,
   plus the previous port in this batch) — make-theme must still compile and a
   2-frame preview must look unchanged.
6. REGISTER: add the identity row to CATALOG.md (voice/when/needs, author →
   make-theme) and a line in themes/README.md if it has one.

## Hard rules

- The CONTRACT.md disciplines apply verbatim (determinism, physics doctrine,
  body stability, apex-owns-frame, equal-length keyframes, fonts whitelist,
  ≤ DUR scheduling): `~/Downloads/cap_fx3/CONTRACT.md`.
- Never edit existing setpieces'/paradigms' behavior unless fixing a bug —
  existing themes must not change appearance.
- Do NOT commit; the orchestrator reviews and commits per batch.
