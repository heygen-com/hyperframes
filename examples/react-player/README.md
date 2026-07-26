# @hyperframes/react-player-example

Demo app for the React bindings shipped at [`@hyperframes/player/react`](../player#react). Renders the `<HyperframesPlayer>` component against a bundled copy of the `motion-blur` registry example and exercises the full binding surface:

- Props → attributes (`controls`, `muted`, `loop`, `playbackRate`) via the option toggles
- Event callbacks (`onReady`, `onPlay`, `onPause`, `onTimeUpdate`, `onEnded`, `onScenes`, `onError`) via the event log
- The imperative ref handle (`play()`, `pause()`, `seek()`) via the custom transport bar

## Run

```bash
bun install          # from the repo root
bun run --filter '@hyperframes/{parsers,lint,studio-server}' build
bun run --filter @hyperframes/core build
bun run --filter @hyperframes/player build   # the react subpath resolves to player dist
cd examples/react-player
bun run dev
```

The demo composition lives at `public/composition/index.html` — an unmodified copy of `registry/examples/motion-blur`. Swap in any composition (e.g. one scaffolded with `hyperframes init`) by replacing that file or pointing `COMPOSITION_SRC` in `src/App.tsx` elsewhere.

This package is private and never published.
