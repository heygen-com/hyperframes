# HyperFrames Tailwind

HyperFrames `init --tailwind` uses the Tailwind browser runtime pinned by the scaffold. Treat it as Tailwind v4, not Studio's Tailwind v3 setup.

## When To Use

- The project was scaffolded with `npx hyperframes init --tailwind`.
- `index.html` contains `window.__tailwindReady`.
- The task asks for Tailwind utility classes, `@theme`, custom utilities, or v3-to-v4 fixes in a composition.
- Rendered frames have missing Tailwind styles or frame-0 flashes.

## Version Contract

- **Pinned: `@tailwindcss/browser@4.2.4`** (source of truth: `packages/cli/src/commands/init.ts` `TAILWIND_BROWSER_VERSION`).
- Do not replace the scaffolded runtime with `cdn.tailwindcss.com` (unpinned, defeats reproducibility).
- Keep the readiness shim deterministic; HyperFrames waits for `window.__tailwindReady` before frame 0 capture.
- For offline / locked-down / production-stable renders, compile Tailwind to CSS and ship the stylesheet instead of the browser runtime.

## v4 Browser Runtime Rules

Tailwind v4 is CSS-first:

```html
<style type="text/tailwindcss">
  @theme {
    --color-brand: oklch(0.68 0.2 252);
    --font-display: "Inter", sans-serif;
  }

  @utility headline-balance {
    text-wrap: balance;
    letter-spacing: 0;
  }
</style>
```

Avoid v3-only patterns in browser-runtime compositions:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

Do not add `tailwind.config.js` only for composition colors, fonts, spacing, or utilities. Use `@theme` and `@utility`.

**Migrating from v3?** Load an existing JS config explicitly: put `@config "./tailwind.config.js";` inside a `text/tailwindcss` block. v4 does **not** auto-detect v3 config files.

## Composition Pattern

Use Tailwind for static layout and style. Keep render-critical timing in GSAP or another seekable HyperFrames adapter.

```html
<section
  id="hero"
  class="clip absolute inset-0 grid place-items-center bg-zinc-950 text-white"
  data-start="0"
  data-duration="5"
  data-track-index="1"
>
  <div class="w-[1280px] max-w-[82vw] text-center">
    <h1 class="text-7xl font-black leading-none text-balance">Render-ready Tailwind</h1>
  </div>
</section>
```

For repeated items, **parameterize via CSS variables** — keep the class list static so the runtime sees every utility:

```html
<span class="translate-y-[calc(var(--i)*6px)] opacity-80" style="--i: 0"></span>
<span class="translate-y-[calc(var(--i)*6px)] opacity-80" style="--i: 1"></span>
<span class="translate-y-[calc(var(--i)*6px)] opacity-80" style="--i: 2"></span>
```

## Dynamic Class Safety

The browser runtime scans classes it can see. Do not build render-critical class names only at seek time:

```js
// Risky: the runtime may never see every generated class.
element.className = `bg-${color}-500`;
```

Prefer complete class tokens in HTML, data variants, or explicit CSS:

```html
<div data-tone="blue" class="bg-blue-500 data-[tone=rose]:bg-rose-500"></div>
```

If a generated class is unavoidable, make sure the full class token appears in a `text/tailwindcss` block before validation.

## Video-Specific Guardrails

v4 + render-mode footguns. Every bullet is a hard rule:

- **Stable dimensions only** — use `w-[…]` / `h-[…]` / `aspect-video` / grid / flex. **No `md:` / `lg:` breakpoints** (renderer is fixed-viewport).
- **Animate via transforms / opacity** — `translate-*`, `scale-*`, `opacity-*` are seek-safe; animating Tailwind sizing utilities is not.
- **No `transition-*` for render-critical motion** — a seekable runtime (GSAP) must own the state.
- **No interaction variants** — `hover:` / `focus:` / `active:` / `group-*:` / `peer-*:` / scroll / pointer variants never fire during render.
- **Bare `border` is broken in v4** — v4 default is `currentColor` (v3 was `gray-200`). Always write the color: `border border-white/20`.
- **v4 utility renames** — `shadow-sm` → `shadow-xs`, `rounded-sm` → `rounded-xs`, `outline-none` → `outline-hidden`, `flex-shrink-*` → `shrink-*`, `flex-grow-*` → `grow-*`.
- **Modern CSS is fine** — `color-mix()`, container queries, logical properties work; the renderer is current Chrome.

## Validation

```bash
npx hyperframes check

# Render proof — frame 0 must NOT flash unstyled content. Preview alone can hide this.
npx hyperframes render . --workers 1 --quality draft --output tailwind-proof.mp4
```

## Quick Debug Checklist

When Tailwind styles don't apply in a render, check in order:

1. Project scaffolded with `npx hyperframes init --tailwind`?
2. `index.html` `<head>` has `<script src="…@tailwindcss/browser@4.2.4…">` (not `cdn.tailwindcss.com`)?
3. `window.__tailwindReady` Promise present in `<head>`?
4. No v3 directives (`@tailwind base/components/utilities`) in the file?
5. Tokens moved from `tailwind.config.js` to `@theme` (or `@config` reference for v3 migration)?
6. Every render-critical class appears as a complete static token (no `bg-${color}-500` style assembly)?
7. Re-run `npx hyperframes check`, then the render proof above.
