# @hyperframes/sdk-playground

Interactive browser playground for the `@hyperframes/sdk` API. Open a composition, edit it through the full SDK op surface, watch the preview update live.

## Running

```bash
bun run --cwd packages/sdk-playground dev
```

Serves at `http://localhost:5173`. On first load it reads `packages/sdk-playground/composition.html` from disk (if present) or falls back to a built-in demo composition.

## Features

### File persistence

Composition state is persisted to `packages/sdk-playground/composition.html` via a Vite dev-server plugin backed by `@hyperframes/sdk/adapters/fs`. Every save writes a timestamped snapshot to `.hf-versions/composition.html/` (capped at 20). Reload the page and your last state is restored.

### Preview iframe

Full composition rendered in a sandboxed `<iframe>`. Supports:

- **Play / Pause / Seek** via the transport bar
- **Click-to-select** elements (highlights in the tree and properties panel)
- **Drag-to-reposition** — drag any element to a new position; on drop the playground calls `comp.setStyle(id, { left, top })`

### Element tree

Lists all non-root elements. Click any row to select it.

### Properties panel

Editable per-element properties for the selected element:

| Section    | SDK op                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| Content    | `comp.setText(id, value)`                                                   |
| Typography | `comp.setStyle(id, { fontSize, fontWeight, color, fontFamily })`            |
| Box        | `comp.setStyle(id, { top, left, width, height })`                           |
| Attributes | `comp.element(id).setAttribute(name, value)` — shows all non-internal attrs |
| Danger     | `comp.element(id).removeElement()`                                          |
| Animations | `comp.setTiming(id, { start, duration })` — inline form per GSAP tween      |

### Timeline

DAW-style per-element tween blocks. Drag handles to trim start/end; drag body to move. All edits go through `comp.setTiming(id, { start, duration })` which keeps the GSAP script and DOM attributes in sync.

### Ops panel

Full op surface, grouped by feature:

| Section                      | SDK op                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- |
| PreviewAdapter.select()      | `preview.select([id])`                                                            |
| setStyle                     | `comp.setStyle(id, styles)`                                                       |
| setText                      | `comp.setText(id, value)`                                                         |
| addGsapTween                 | `comp.addGsapTween(target, spec)`                                                 |
| setTiming                    | `comp.setTiming(id, { start, duration })`                                         |
| setGsapTween                 | `comp.setGsapTween(animId, updates)`                                              |
| moveElement                  | `comp.moveElement(id, { parent, index })`                                         |
| setClassStyle                | `comp.dispatch({ type: "setClassStyle", selector, styles })`                      |
| setAttribute / removeElement | `comp.element(id).setAttribute()` / `.removeElement()`                            |
| setVariableValue             | `comp.setVariableValue(id, value)`                                                |
| find(query)                  | `comp.find({ tag, text, name, track })`                                           |
| selection() proxy            | `comp.selection().setStyle()` / `.removeElement()`                                |
| listVersions / loadFrom      | `adapter.listVersions()` / `adapter.loadFrom()`                                   |
| History / inspect            | `comp.undo()`, `comp.redo()`, `comp.can()`, `comp.getOverrides()`, `comp.flush()` |

### Editor modal

Click "Open editor" to view and directly edit the raw composition HTML. Saving re-opens the composition through the SDK.

---

## Planned / not yet wired

- `comp.setTrackVariable(trackId, variableId)` — variable binding per track
- `comp.addElement(spec)` — create new elements from the UI
- `comp.duplicateElement(id)` — duplicate with offset
- Selection multi-select (current: single-select only)
- Timeline zoom and horizontal scroll for long compositions
- Version history browser — list/preview/restore past versions inline (API is implemented; UI shows only list + load-oldest)
- `comp.on('change', cb)` live event log fed from SDK event stream
- Render to video via `@hyperframes/producer` integration
