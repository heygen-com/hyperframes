# Core Notes

Extended design rationale and context for decisions in `core.md`. This file is for humans reviewing the design — it is not consumed by the LLM agent.

## Interactive Compositions

### Why `data-start="interactive"`

We considered three alternatives:

1. **`data-interactive` boolean attribute** — Keeps `data-start` clean, but then `data-start` must either be omitted (breaking the convention that every clip has `data-start`) or present but meaningless. Two attributes to express what one value handles.

2. **Event-driven `data-start="on:click:#element"`** — More expressive and extensible to other events (`on:hover`, `on:end:#video`), but complex to parse, harder for an LLM to author correctly, and the trigger/target relationship is declared on the target which reads backwards.

3. **`data-start="interactive"` (chosen)** — Reuses the existing `data-start` attribute with a new keyword value. Reads naturally: "when does this start?" → "interactively." One attribute, no ambiguity, easy to parse (`=== "interactive"` check).

The tradeoff is that `data-start` is now overloaded (was purely numeric/reference, now has a keyword). We accepted this because the parsing is trivial and the readability gain is significant.

### Why `window.__navigate()` instead of `data-goto`

Navigation is behavior, not structure. The framework's philosophy separates these: HTML declares structure and timing, scripts handle behavior.

A `data-goto="composition-id"` attribute on trigger elements would be declarative and concise, but limits what authors can do. With a runtime API, scripts can:

- Add conditional logic (`if (score > 50) navigate('win') else navigate('lose')`)
- Animate a transition before navigating
- Add delays or timeouts
- Chain multiple actions on a single click
- Use any DOM event, not just clicks

The trigger element is just normal HTML with a normal `addEventListener`. The LLM only needs to know `window.__navigate(id)` — plain JS.

### Navigation Behavior: Replace

When `__navigate()` is called:

1. The currently active composition's timeline pauses
2. The current composition hides (visibility/display)
3. The target interactive composition shows
4. The target's timeline seeks to 0 and plays

We chose Replace (parent hides entirely) over Overlay (target plays on top) or Pause-and-branch (parent pauses, resumes when target ends) because it's the simplest mental model and matches how most interactive video works (YouTube branching, Netflix Bandersnatch).

### Ownership Model

Interactive compositions are children of the composition that branches to them in the DOM tree. The parent composition is the "root" of its branching experience — it owns its branches.

However, `window.__navigate()` resolves composition IDs globally across the full tree, not scoped to the current parent. This means:

- A deeply nested interactive composition can navigate to any other interactive composition by ID
- A shared "game over" or "credits" composition can be reached from anywhere
- Circular navigation is possible (A → B → A) — the framework does not prevent loops

### Future Extensions

These are not implemented but the design accommodates them without breaking changes:

- **Overlay mode**: `window.__navigate(id, { mode: 'overlay' })` — target plays on top, parent pauses or continues
- **History / back**: `window.__navigate('$back')` to return to the previous composition, `window.__navigateHistory` to read the stack
- **Auto-advance / timeout**: Scripts can implement this today with `setTimeout(() => window.__navigate('default'), 10000)`. A declarative shorthand could be added later.
- **Pause-and-branch**: `window.__navigate(id, { mode: 'branch' })` — parent pauses, resumes when target ends
