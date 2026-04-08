# HyperFrames Design System & Style Guide

Use this guide to configure Mintlify docs or any other platform to match the HyperFrames brand.

---

## Color Palette

### Light Mode

| Token              | Hex       | Usage                                            |
| ------------------ | --------- | ------------------------------------------------ |
| `--bg`             | `#f6f5f1` | Page background                                  |
| `--surface`        | `#ffffff` | Cards, panels, elevated surfaces                 |
| `--surface2`       | `#eeedea` | Secondary surfaces, timeline, subtle backgrounds |
| `--border`         | `#e0dfdb` | Default borders                                  |
| `--border-light`   | `#d0cfcb` | Hover/active borders                             |
| `--text`           | `#1a1a1a` | Primary body text                                |
| `--text-secondary` | `#6b6b6b` | Secondary/muted text                             |
| `--text-tertiary`  | `#999999` | Tertiary/placeholder text                        |
| `--heading`        | `#0a0a0a` | Headings, nav brand, buttons                     |
| `--code-bg`        | `#ffffff` | Code block backgrounds                           |

#### Accent Colors (Light)

| Token                    | Hex                     | Usage                        |
| ------------------------ | ----------------------- | ---------------------------- |
| `--accent-green`         | `#1a7a0a`               | Success, recommended badges  |
| `--accent-green-light`   | `rgba(26,122,10,0.07)`  | Green badge backgrounds      |
| `--accent-green-border`  | `rgba(26,122,10,0.25)`  | Green badge borders          |
| `--accent-blue`          | `#2563eb`               | Links, info badges           |
| `--accent-blue-light`    | `rgba(37,99,235,0.06)`  | Blue badge backgrounds       |
| `--accent-blue-border`   | `rgba(37,99,235,0.2)`   | Blue badge borders           |
| `--accent-purple`        | `#7c3aed`               | Highlights, special elements |
| `--accent-purple-light`  | `rgba(124,58,237,0.06)` | Purple badge backgrounds     |
| `--accent-purple-border` | `rgba(124,58,237,0.2)`  | Purple badge borders         |

#### Syntax Highlighting (Light)

| Token                  | Hex       | Usage                           |
| ---------------------- | --------- | ------------------------------- |
| `--syntax-keyword`     | `#9333ea` | Keywords (const, let, function) |
| `--syntax-function`    | `#0891b2` | Function names                  |
| `--syntax-string`      | `#16a34a` | Strings, values                 |
| `--syntax-number`      | `#d97706` | Numbers                         |
| `--syntax-property`    | `#6366f1` | Object properties               |
| `--syntax-punctuation` | `#aaaaaa` | Brackets, semicolons            |
| `--syntax-tag`         | `#b45309` | HTML/JSX tags                   |
| `--syntax-attribute`   | `#555555` | HTML attributes                 |
| `--syntax-comment`     | `#bbbbbb` | Comments                        |

---

### Dark Mode

| Token              | Hex       | Usage                            |
| ------------------ | --------- | -------------------------------- |
| `--bg`             | `#0a0a0a` | Page background                  |
| `--surface`        | `#141414` | Cards, panels, elevated surfaces |
| `--surface2`       | `#1a1a1a` | Secondary surfaces               |
| `--border`         | `#2a2a2a` | Default borders                  |
| `--border-light`   | `#3a3a3a` | Hover/active borders             |
| `--text`           | `#e5e5e5` | Primary body text                |
| `--text-secondary` | `#a0a0a0` | Secondary/muted text             |
| `--text-tertiary`  | `#666666` | Tertiary/placeholder text        |
| `--heading`        | `#f5f5f5` | Headings                         |
| `--code-bg`        | `#141414` | Code block backgrounds           |

#### Accent Colors (Dark)

| Token                    | Hex                     | Usage                        |
| ------------------------ | ----------------------- | ---------------------------- |
| `--accent-green`         | `#22c55e`               | Success, recommended badges  |
| `--accent-green-light`   | `rgba(34,197,94,0.1)`   | Green badge backgrounds      |
| `--accent-green-border`  | `rgba(34,197,94,0.3)`   | Green badge borders          |
| `--accent-blue`          | `#3b82f6`               | Links, info badges           |
| `--accent-blue-light`    | `rgba(59,130,246,0.1)`  | Blue badge backgrounds       |
| `--accent-blue-border`   | `rgba(59,130,246,0.3)`  | Blue badge borders           |
| `--accent-purple`        | `#a78bfa`               | Highlights, special elements |
| `--accent-purple-light`  | `rgba(167,139,250,0.1)` | Purple badge backgrounds     |
| `--accent-purple-border` | `rgba(167,139,250,0.3)` | Purple badge borders         |

#### Syntax Highlighting (Dark)

| Token                  | Hex       | Usage                |
| ---------------------- | --------- | -------------------- |
| `--syntax-keyword`     | `#c084fc` | Keywords             |
| `--syntax-function`    | `#22d3ee` | Function names       |
| `--syntax-string`      | `#4ade80` | Strings, values      |
| `--syntax-number`      | `#fbbf24` | Numbers              |
| `--syntax-property`    | `#818cf8` | Object properties    |
| `--syntax-punctuation` | `#666666` | Brackets, semicolons |
| `--syntax-tag`         | `#fb923c` | HTML/JSX tags        |
| `--syntax-attribute`   | `#a0a0a0` | HTML attributes      |
| `--syntax-comment`     | `#555555` | Comments             |

---

## Typography

### Font Families

| Token            | Stack                                                                         | Usage                  |
| ---------------- | ----------------------------------------------------------------------------- | ---------------------- |
| `--font-display` | `'ABC Solar Display', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif` | Headlines, nav brand   |
| `--font-body`    | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`          | Body text, UI elements |
| `--font-mono`    | `'IBM Plex Mono', 'SF Mono', 'Fira Code', monospace`                          | Code, terminals        |

### Google Fonts Import

```css
@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap");
```

### Type Scale

| Element    | Size                           | Weight | Letter Spacing | Line Height |
| ---------- | ------------------------------ | ------ | -------------- | ----------- |
| H1         | `clamp(2.6rem, 6vw, 4.5rem)`   | 400    | `-0.02em`      | 1.0         |
| H2         | `clamp(1.6rem, 3.5vw, 2.2rem)` | 400    | `-0.02em`      | 1.2         |
| H3         | `1rem`                         | 600    | `-0.01em`      | 1.4         |
| Body       | `1rem`                         | 400    | `normal`       | 1.6         |
| Body Small | `0.95rem`                      | 400    | `normal`       | 1.7         |
| Caption    | `0.82rem`                      | 400    | `normal`       | 1.6         |
| Code       | `0.75rem`                      | 400    | `normal`       | 1.9         |
| Mono Small | `0.65rem`                      | 500    | `normal`       | 1.6         |

---

## Spacing

| Token | Value           | Usage               |
| ----- | --------------- | ------------------- |
| `xs`  | `0.25rem` (4px) | Tight gaps          |
| `sm`  | `0.5rem` (8px)  | Small gaps          |
| `md`  | `1rem` (16px)   | Default gaps        |
| `lg`  | `1.5rem` (24px) | Section gaps        |
| `xl`  | `2rem` (32px)   | Large spacing       |
| `2xl` | `4rem` (64px)   | Section padding     |
| `3xl` | `8rem` (128px)  | Hero/footer padding |

---

## Border Radius

| Token | Value           | Usage                  |
| ----- | --------------- | ---------------------- |
| `sm`  | `4px`           | Badges, small elements |
| `md`  | `6px`           | Buttons, inputs        |
| `lg`  | `8px`           | Cards, panels          |
| `xl`  | `10px` - `12px` | Large cards            |

---

## Shadows & Effects

- **No heavy shadows** — HyperFrames uses a flat, minimal aesthetic
- **Borders over shadows** — Use `1px solid var(--border)` instead of box-shadows
- **Backdrop blur** for nav: `backdrop-filter: blur(12px)`
- **Selection color**: `rgba(128,128,128,0.2)` (light) / `rgba(255,255,255,0.15)` (dark)

---

## Mintlify Configuration

The docs site at `docs/docs.json` implements this design system. Key settings:

```json
{
  "theme": "maple",
  "colors": {
    "primary": "#0a0a0a",
    "light": "#f6f5f1",
    "dark": "#0a0a0a"
  },
  "background": {
    "color": {
      "light": "#f6f5f1",
      "dark": "#0a0a0a"
    }
  },
  "fonts": {
    "family": "Inter",
    "heading": { "family": "Inter" }
  },
  "appearance": {
    "default": "light"
  }
}
```

Additional overrides (code font, CSS variables, heading tracking) live in `docs/custom.css`.

---

## Component Patterns

### Cards

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  transition: border-color 0.2s;
}

.card:hover {
  border-color: var(--border-light);
}
```

### Buttons

```css
.btn-primary {
  font-size: 0.8rem;
  padding: 0.4rem 1rem;
  border-radius: 6px;
  background: var(--heading);
  color: #fff;
  font-weight: 500;
}

[data-theme="dark"] .btn-primary {
  background: var(--heading);
  color: #0a0a0a;
}
```

### Code Blocks / Terminals

```css
.terminal {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.terminal-bar {
  display: flex;
  gap: 5px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.terminal-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-light);
}

.terminal-body {
  padding: 0.85rem 1.1rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.9;
}
```

### Badges

```css
.badge-green {
  color: var(--accent-green);
  background: var(--accent-green-light);
  border: 1px solid var(--accent-green-border);
}

.badge-blue {
  color: var(--accent-blue);
  background: var(--accent-blue-light);
  border: 1px solid var(--accent-blue-border);
}

.badge-purple {
  color: var(--accent-purple);
  background: var(--accent-purple-light);
  border: 1px solid var(--accent-purple-border);
}
```

---

## Animation Guidelines

- **Duration**: 0.15s - 0.2s for micro-interactions, 0.5s for reveals
- **Easing**: `ease` or `ease-out` for most transitions
- **Hover states**: Use `opacity: 0.85` or border color changes
- **Scroll reveals**: `translateY(20px)` with opacity fade

---

## Brand Assets

- **Logo**: "HyperFrames" in `--font-display` at 600 weight
- **Primary color**: `#0a0a0a` (near-black)
- **Warm neutral palette**: Beige/cream tones, not pure grays
