# VS Code Theme Visualizer Design Notes

## Intent

This POC should feel like a real VS Code tutorial capture, not a generic code window. The purpose is to prove that HyperFrames can render code-writing scenes with faithful product context and theme-aware polish.

## Visual Identity

The visual identity is sourced from official VS Code built-in theme JSON files from `microsoft/vscode/extensions/theme-defaults/themes`. Do not invent palette values for the workbench. Colors should flow through the generated theme registry and CSS variables.

## Theme Set

- Light 2026
- Dark 2026
- Dark+
- Dark Modern
- Light+
- Light Modern
- Visual Studio Dark
- Visual Studio Light
- Default High Contrast
- Default High Contrast Light

## Typography

- Workbench UI: `Inter`, then system UI fallbacks.
- Code and terminal: `Menlo`, `Monaco`, `Consolas`, then monospace fallbacks.
- Keep letter spacing at `0`.

## Layout Rules

- Recreate the VS Code workbench proportions: activity bar, explorer sidebar, editor tabs, editor gutter, status bar, and optional terminal panel.
- Use official theme colors for editor, sidebar, tabs, activity bar, panel, terminal, and status bar surfaces.
- Keep the composition full-frame at 1920x1080.
- Cards are allowed only for the theme selector strip because they are repeated selectable items.
- Do not use decorative gradients, glows, or synthetic color accents outside theme-derived colors.

## Motion Rules

- Theme changes should feel like command-palette theme switching: quick, crisp, and functional.
- Code typing is the hero action. UI chrome should support it without becoming theatrical.
- All animation must be deterministic and GSAP-controlled.
