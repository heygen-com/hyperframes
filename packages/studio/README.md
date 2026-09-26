# @hyperframes/studio

Browser-based composition editor UI for Hyperframes. Provides a visual timeline, code editor, and live preview for building video compositions.

## Install

```bash
npm install @hyperframes/studio
```

## What it does

The studio is a React application with:

- **Visual timeline** — drag, resize, and arrange elements on tracks
- **Code editor** — edit HTML and GSAP scripts with CodeMirror (syntax highlighting, autocomplete)
- **Live preview** — see changes in real time as you edit
- **Composition inspector** — view and modify element properties

## Host panels

An app that mounts `StudioApp` can add its own panels to the dock — an agent chat, a task log, a project browser — and they behave like the built-in ones: a tab in their side column (after the built-ins), an entry in the Window menu, a place the saved layout remembers.

```tsx
import { StudioApp } from "@hyperframes/studio";

<StudioApp
  hostPanels={[
    { id: "agent", title: "Agent", zone: "right", content: <AgentPanel /> },
    { id: "tasks", title: "Tasks", zone: "left", keepMounted: true, content: <TasksPanel /> },
  ]}
/>;
```

`zone` is `"left"` or `"right"` (the centre holds the preview and the timeline). `keepMounted` keeps the content alive while its tab is hidden. By default a panel reopens as a tab of its column's first panel; `reopen: { near, direction }` picks another place. Ids must not reuse a built-in panel's. The panels are read at mount.

A host that composes `EditorShell` itself passes the same definitions as `hostPanels` and renders each one as a `Dock.Panel` inside `panels`.

## Development

The studio is embedded in the `hyperframes preview` command. To develop the studio UI itself:

```bash
cd packages/studio
bun run dev        # Start Vite dev server
bun run build      # Build for production
bun run typecheck  # Type-check
```

## Tech stack

- React 19, Zustand 4/5 (state management; development uses Zustand 5)
- CodeMirror 6 (editor)
- Tailwind CSS (styling)
- Vite (bundler)
- Phosphor Icons

## Documentation

Full documentation: [hyperframes.heygen.com/packages/studio](https://hyperframes.heygen.com/packages/studio)

## Related packages

- [`@hyperframes/core`](../core) — types and parsers used by the editor
- [`hyperframes`](../cli) — CLI that serves the studio via `hyperframes preview`
