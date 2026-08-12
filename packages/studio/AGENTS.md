# Working on Studio

Read this before your first change in `packages/studio`. It is the handful of
things that are not visible from the source, and that cost real time to
rediscover.

## The shape of the thing

Studio renders the user's composition in an **iframe**, and draws its own
chrome — selection box, handles, dashed outlines, toolbars — in **Studio's own
document**, positioned over the iframe. Nothing Studio draws lives inside the
composition, because a render would capture it and the composition's styling
would inherit into it.

Two consequences you will meet immediately:

- Reaching a preview element from a driver or a test means going through the
  iframe: `iframe.contentDocument.getElementById(...)`. Studio's own panels may
  be inside shadow roots, so a plain `document.querySelector` finds neither.
- Every overlay box is a _measurement_ of an element, not the element. When
  chrome disagrees with the pixels underneath it, the bug is almost always in
  the measurement, in `components/editor/domEditOverlayGeometry.ts`.

## Driving Studio for verification

A pixel-precise click inside the preview is not something an automated driver
can reliably land, and some gestures cannot be synthesised at all: the canvas
overlay takes pointer capture and recognises a double press itself, so
`page.mouse` click pairs do not open a text edit no matter how they are timed.

Use the dev-only hook instead. In a dev build `window.__studioTest` exposes:

```js
await window.__studioTest.selectByDomId("headline"); // selects, reveals the inspector
```

That is the same selection a click produces. The general lesson: from a settled
selection, keyboard paths are dependable where pointer paths are not. Prefer a
key over a synthesised gesture whenever the feature offers one.

`useStudioTestHooks` also carries the timeline performance fixtures. The hook is
gated on `STUDIO_TEST_HOOKS_ENABLED` (dev or development mode only), so
`window.__studioTest` is absent in production builds — feature-detect it.

## Tracing decisions

The interesting failures here are decisions, not crashes: a preview that
reloads when it should not, a shift-click that selects the wrong element.
Nothing throws, so a trace of the decision is the only way to avoid guessing.

Channels are off by default. Turn one on and reload:

```js
localStorage.setItem("hf-drag-debug", "1"); // then grep the console for [hf-drag]
```

Live channels: `reload`, `select`, `drag`, `resize`, `commit`. Add one with
`makeStudioDebugLogger("<name>")` in `utils/studioDebug.ts`.

## Running the tests

Studio's tests are **vitest**, not `bun test`. Running bare `bun test` in this
package collects the files with the wrong runner and reports failures that are
not real:

```bash
bun run --cwd packages/studio test                       # all of them
bun run --cwd packages/studio test src/components/editor # one directory
```

happy-dom is not a browser. It does not reflect the individual transform
properties (`rotate`, `scale`, `translate`) into computed style, and it has no
`DOMMatrix` — the geometry tests carry their own stand-in. When a behaviour
depends on real layout or real computed style, prove it in a browser and keep
the unit test on the pure function underneath.

## Gates that will fail your PR

- **600 lines per file.** CI checks only non-test files your PR changed. A file
  that grows past it has to be split in the same PR that grew it.
- **`bunx fallow audit --base origin/main --fail-on-issues`** — complexity per
  function, duplication, unused exports. Adding branches to an already-complex
  function trips it; extract rather than nest.
- **oxlint and oxfmt**, not eslint or prettier.

## Traps worth knowing

- **`rotate` is not `transform`.** Studio's rotate handle writes the CSS
  `rotate` property, which is an individual transform property and does not
  appear in `getComputedStyle(el).transform`. Anything measuring an angle has to
  read both and compose them the way CSS does, individual properties first.
- **A seek re-renders the whole timeline**, not the tween you patched. Patching
  several elements one at a time and seeking after each repaints the ones still
  queued from their un-patched tweens. Batch, then render once.
- **Studio's own writes must not reload the preview.** Writes carry a token so
  the file-watcher event can be recognised as ours; a new write path that
  forgets it makes the preview flash on every edit.
- **Preserving a selection set that does not contain the id empties it.** Check
  `preserveSet` semantics before reusing it.
