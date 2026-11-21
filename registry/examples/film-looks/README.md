# Film Looks

Three **original** Rec.709 film-look approximations for HyperFrames color grading:

| Look              | Feel                               |
| ----------------- | ---------------------------------- |
| `soft-color-neg`  | Warm, soft negative-style print    |
| `vivid-slide`     | High-saturation slide-style punch  |
| `cinema-daylight` | Denser daylight cinema-style grade |

Each look is a project-local `.cube` plus `details.grain` / `vignette` in `data-color-grading`.

**Not** measured film stock data. **Not** affiliated with any film manufacturer.  
**Not** derived from SpektraLens / spektrafilm (GPL / CC BY-SA).

## Regenerate LUTs

```bash
node scripts/generate-film-look-luts.mjs
```

## Apply to your own media

```bash
npx hyperframes media-treatment \
  --selector '#hero' \
  --grading "$(cat grades/soft-color-neg.json)" \
  --apply
```

LUT paths in the JSON are relative to the project root after install. Keep the
`.cube` files under `assets/luts/` next to your composition (remote LUT URLs are
rejected by the runtime).
