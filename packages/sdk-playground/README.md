# @hyperframes/sdk-playground

Interactive browser playground for the `@hyperframes/sdk` API. Open a composition, edit it through the full SDK op surface, watch the preview update live.

## Running

```bash
bun run --cwd packages/sdk-playground dev
```

Serves at `http://localhost:5173`. On first load it reads `packages/sdk-playground/composition.html` from disk (if present) or falls back to a built-in demo composition.

## What this demonstrates

The playground exercises the full SDK surface end-to-end in a real browser against a
file-backed persist adapter. It was built to verify SDK stages 3b and 4 before Studio
migration begins:

| SDK stage              | What is exercised                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage 3a — Session API | `openComposition`, `dispatch`, `undo`/`redo`, `batch`, `on('patch')`, `on('selectionchange')`, `on('persist:error')`, `flush`                           |
| Stage 3b — GSAP engine | `addGsapTween`, `setGsapTween`, `removeGsapTween`, `addLabel`, `removeLabel`, `setClassStyle`, `setTiming` (GSAP-script sync)                           |
| Stage 4 (partial)      | `can()` returning `CanResult`, `getOverrides()`, `selection()` proxy, `find()`, `setVariableValue`                                                      |
| Stage 5 (partial)      | `FsAdapter` — file-backed persistence with version history; `FileAdapter` — browser fetch adapter; `PlaygroundPreview` — concrete `PreviewAdapter` impl |

## Features

### File persistence

Composition state is persisted to `packages/sdk-playground/composition.html` via a Vite dev-server plugin backed by `@hyperframes/sdk/adapters/fs`. Every save writes a timestamped snapshot to `.hf-versions/composition.html/` (capped at 20). Reload the page and your last state is restored.

### Preview iframe

Full composition rendered in a sandboxed `<iframe>`. Supports:

- **Play / Pause / Seek** via the transport bar
- **Click-to-select** elements (highlights in the tree and properties panel)
- **Drag-to-reposition** — drag any element; on drop calls `comp.setStyle(id, { left, top })`

### Element tree

Lists all non-root elements. Click any row to select it.

### Properties panel

Editable per-element properties for the selected element:

| Section    | SDK op                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| Content    | `comp.setText(id, value)`                                                   |
| Typography | `comp.setStyle(id, { fontSize, fontWeight, color })`                        |
| Box        | `comp.setStyle(id, { background, opacity, left, top })`                     |
| Attributes | `comp.element(id).setAttribute(name, value)` — all non-internal attrs       |
| Danger     | `comp.element(id).removeElement()`                                          |
| Animations | Lists tween IDs + inline "Add tween" form via `comp.addGsapTween(id, spec)` |

### Timeline

DAW-style per-element tween blocks. Drag handles to trim start/end; drag body to move. All edits go through `comp.setTiming(id, { start, duration })`, which keeps the GSAP script and `data-start`/`data-end` attributes in sync.

### Ops panel

Full op surface, grouped by feature:

| Section                        | SDK op                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| PreviewAdapter.select()        | `preview.select([id])`                                                                          |
| setStyle                       | `comp.setStyle(id, styles)`                                                                     |
| setText                        | `comp.setText(id, value)`                                                                       |
| addGsapTween                   | `comp.addGsapTween(target, spec)`                                                               |
| setGsapTween / removeGsapTween | `comp.setGsapTween(animId, { duration })` / `comp.removeGsapTween(animId)`                      |
| addLabel / removeLabel         | `comp.dispatch({ type: "addLabel", name, position })` / `removeLabel`                           |
| setClassStyle                  | `comp.dispatch({ type: "setClassStyle", selector, styles })`                                    |
| setAttribute / removeElement   | `comp.element(id).setAttribute()` / `.removeElement()`                                          |
| setVariableValue               | `comp.setVariableValue(id, value)`                                                              |
| find(query)                    | `comp.find({ tag, text })`                                                                      |
| selection() proxy              | `comp.selection().setStyle()` / `.removeElement()`                                              |
| listVersions / loadFrom        | `adapter.listVersions(path)` / `adapter.loadFrom(path, key)`                                    |
| History / inspect              | `comp.undo()`, `comp.redo()`, `comp.can(op) → CanResult`, `comp.getOverrides()`, `comp.flush()` |

`can(op)` returns a `CanResult`: `{ok: true}` or `{ok: false, code, message, hint?}`. The ops panel logs the full result object so you can inspect validation failures in real time.

### Editor modal

Click "Open editor" to view and directly edit the raw composition HTML. Saving re-opens the composition through the SDK, so all patches and history are reset cleanly.

### Event log

Every `patch`, `undo`, `redo`, `selectionchange`, and `persist:error` event is logged with its payload. Useful for verifying RFC 6902 patch shape and override-set accumulation.

---

## Planned / not yet wired

- `addGsapKeyframe` / `setGsapKeyframe` / `removeGsapKeyframe` — ops are implemented in the SDK; not yet exposed in the UI
- `comp.setTrackVariable(trackId, variableId)` — variable binding per track
- `comp.addElement(spec)` — create new elements from the UI
- `comp.duplicateElement(id)` — duplicate with offset
- Selection multi-select (current: single-select only)
- Timeline zoom and horizontal scroll for long compositions
- Version history browser — list/preview/restore past versions inline (listVersions/loadFrom API is implemented; UI shows raw list + load-oldest button only)
- Render to video via `@hyperframes/producer` integration
