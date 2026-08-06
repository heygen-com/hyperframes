# Design System & Reusable Components

Hyperframes supports a global design system via `theme.json` and reusable HTML components.

## 1. Global Theme (`templates/theme.json`)

Define your brand's colors, typography, and spacing once:

```json
{
  "colors": { "accent": "#FF5733" },
  "typography": { "heading": { "fontSize": "72px" } }
}
```

All CSS variables are auto-injected at render time with the prefix `--hf-*`:
- `--hf-color-accent`
- `--hf-font-family`
- `--hf-heading-size`
- `--hf-spacing-margin`

## 2. Reusable Components (`templates/components/`)

Pre-built components live in `templates/components/`. Copy any into your composition:

- `LowerThird.html` — name + title overlay
- `Outro.html` — branded end card

## 3. Style Inheritance Order