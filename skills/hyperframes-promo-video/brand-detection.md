# Brand Auto-Detection

Run in Phase 2.4. Detects logo, colors, font, intro/outro from the repo. Skill presents findings and asks for confirmation.

## Detection Order

For each field, try sources in order. Stop at first match.

### Logo

1. `public/logo.svg`, `public/logo.png`
2. `assets/logo.svg`, `assets/logo.png`
3. `static/logo.svg`, `static/logo.png`
4. `apps/*/public/logo.{svg,png}` (monorepo layouts)
5. `public/favicon.svg`, `public/favicon.png` (fallback)

If multiple variants (`logo-light.svg`, `logo-dark.svg`), prefer the one matching the background color chosen for the video (dark logo on light bg, light logo on dark bg).

### Primary Color

1. `tailwind.config.{js,ts,mjs,cjs}` — search for `primary` key under `theme.extend.colors` or `theme.colors`
2. CSS custom properties: grep `--primary` in `.css` files under `app/`, `src/`, `styles/`
3. Standalone brand files: `brand.json`, `design-tokens.json`, `theme.json` at repo root
4. `tailwind.config` `theme.colors.blue[500]` as a conservative fallback if no explicit primary

### Accent / Background / Text Colors

Same sources as primary, searching for keys `accent`, `background`, `foreground` / `text`. If missing, fall back to:

- Accent: same-hue sibling of primary (primary-dark or primary-light)
- Background: `#ffffff`
- Text: `#0a0a0a`

### Font Family

1. `next/font` imports in `app/layout.tsx`, `pages/_app.tsx` → extract font name
2. `@fontsource/*` packages in `package.json` → extract font name
3. Tailwind `theme.extend.fontFamily.sans` → extract first entry
4. CSS `@import url("https://fonts.googleapis.com/...")` in global styles
5. Fallback: `"Inter"` (most common and reliably available on Google Fonts)

If the detected font is a Google Font, load it via a `<link>` tag pointing at `https://fonts.googleapis.com/css2?family=<Name>` in the project's `index.html`. Otherwise, use a fallback Google Font and warn: "Detected font `SF Pro Display` is not a Google Font; falling back to `Inter`. Provide a self-hosted font file to use `SF Pro Display`."

### Intro / Outro Clips

1. `marketing/intro.{mp4,webm,mov}`
2. `marketing/outro.{mp4,webm,mov}`
3. `assets/intro.*`, `assets/outro.*`

Optional. If not found, skip — the HookTitle and CTAEndScreen scenes are self-contained.

## Persistence

On first successful detection + user confirmation, write `.marketing/brand.json` (relative to repo root):

```json
{
  "logoPath": "public/logo.svg",
  "colors": {
    "primary": "#0066ff",
    "accent": "#ff6600",
    "background": "#ffffff",
    "text": "#0a0a0a"
  },
  "font": {
    "family": "Inter",
    "googleFont": "Inter"
  },
  "introPath": null,
  "outroPath": null
}
```

On subsequent runs, skill asks: "Use saved brand from `.marketing/brand.json`, or re-detect?"

## Fallback Defaults

When auto-detection finds nothing:

```json
{
  "logoPath": null,
  "colors": {
    "primary": "#3B82F6",
    "accent": "#8B5CF6",
    "background": "#0A0A0A",
    "text": "#FFFFFF",
    "muted": "#9CA3AF",
    "success": "#22C55E",
    "danger": "#EF4444"
  },
  "font": {
    "family": "Geist",
    "googleFont": "Geist"
  },
  "introPath": null,
  "outroPath": null
}
```

Ask user to confirm or provide their own values before scaffolding.
