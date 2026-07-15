# hyperframes-vst-host

Python sidecar that hosts VST3/AU plugins (via [pedalboard](https://github.com/spotify/pedalboard))
for HyperFrames Studio and the render pipeline: an offline WAV → WAV `bounce`
used at render time, and a WebSocket `serve` mode used for live FX preview
(parameter tweaking, native plugin editor windows, streamed processed audio)
in Studio.

## Install

- **Standalone (published package):**

  ```bash
  uv tool install hyperframes-vst-host
  ```

- **Monorepo dev (source checkout, no install step):**

  ```bash
  uv run --project packages/vst-host hyperframes-vst <command>
  ```

  This is what the TypeScript callers use automatically — neither requires a
  manual install in a source checkout. `resolveVstHostCommand()`
  (`packages/engine/src/services/vstBounce.ts` for render, and its sibling
  copy in `packages/studio-server/src/vstSidecar.ts` for the Studio sidecar)
  falls back to `uv run --project <packages/vst-host> hyperframes-vst` the
  moment `packages/vst-host/pyproject.toml` is found relative to the caller,
  and only falls back further to a bare `hyperframes-vst` on `PATH` (the
  installed/published case) when that monorepo layout isn't present.

- **Override (CI / dev, arbitrary executable or a test fake):** set
  `HF_VST_HOST_CMD` to a space-split command; it takes precedence over both
  of the above.

## CLI

```
hyperframes-vst <command>
```

| command  | flags                                               | purpose                                                                                                                      |
| -------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `bounce` | `--input <wav> --chain <chain.json> --output <wav>` | Offline render a WAV through a chain, block-by-block, no realtime clock. Used by the render pipeline's `applyVstChainToWav`. |
| `scan`   | `--dirs [...] --json`                               | Scan plugin directories (or the default set), print a registry JSON to stdout.                                               |
| `probe`  | `<path>`                                            | Probe one plugin bundle in a subprocess — some bundles crash pedalboard's loader, so callers isolate one path at a time.     |
| `serve`  | `--port N` (default: OS-assigned)                   | Run the WebSocket sidecar used by Studio's live FX preview.                                                                  |

### `bounce` exit codes

- **`0`** — success; the processed WAV is written to `--output`.
- **`3`** — `PLUGIN_MISSING <name>` printed to stderr: the chain file
  references a plugin that isn't installed/found on this machine. The render
  pipeline (`packages/engine/src/services/vstBounce.ts`'s
  `applyVstChainToWav`) reads this exit code + stderr line and hard-fails the
  whole render, naming the specific missing plugin and the track — a missing
  plugin at render time is never a silent fallback to unprocessed dry audio.
- Any other non-zero code is treated as a generic sidecar failure and
  surfaced with the tail of stderr.

## Sidecar readiness handshake

`serve` prints exactly one readiness line to stdout the moment its WebSocket
server is bound:

```
VST-HOST-LISTENING port=<N>
```

Callers wait for this line (matched against `/VST-HOST-LISTENING
port=(\d+)/`) before treating the sidecar as ready; a 30-second timeout
without it is treated as a failed start (see `startVstSidecar` in
`packages/studio-server/src/vstSidecar.ts`).

## WebSocket protocol

One socket, two lanes: JSON text frames for control commands/events, and raw
binary frames for interleaved PCM samples during playback. Implemented in
`src/hyperframes_vst/server.py` (dispatch) and `src/hyperframes_vst/stream.py`
(PCM framing); mirrored client-side in `packages/studio/src/hooks/useVstHost.ts`.

### Client → server (`{"cmd": ...}`)

| cmd            | fields                                                 | effect                                                                                             |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `scan`         | `paths?: string[]`                                     | Scans plugin dirs (or the default set); replies `registry`                                         |
| `load-chain`   | `trackId, chainJson, wavPath`                          | Builds the live plugin chain for a track, (re)opens its audio stream; replies `chain-loaded`       |
| `unload-chain` | `trackId`                                              | Tears down a track's stream and plugin instances                                                   |
| `set-param`    | `trackId, pluginIndex, param, value`                   | Sets one live plugin parameter                                                                     |
| `open-editor`  | `trackId, pluginIndex`                                 | Opens the plugin's native editor window (spawned on its own thread)                                |
| `close-editor` | `trackId, pluginIndex`                                 | No-op server-side — pedalboard editor windows close from their own window chrome, not this command |
| `get-state`    | `trackId`                                              | Replies `state` with each plugin's base64-encoded state                                            |
| `transport`    | `action: "play" \| "pause" \| "seek", timeSec?, rate?` | Drives playback/seek for every loaded track's PCM streaming lane                                   |

### Server → client (`{"event": ...}`)

| event          | fields                       | meaning                                                                                                                |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `registry`     | `plugins: [...]`             | Result of a `scan`                                                                                                     |
| `chain-loaded` | `trackId, params`            | A `load-chain` completed; `params` is per-plugin parameter metadata                                                    |
| `state`        | `trackId, plugins: string[]` | Result of `get-state` — one base64 state blob per plugin, in chain order                                               |
| `error`        | `code, plugin?, trackId?`    | A command failed. `code: "plugin_missing"` carries the plugin name in `plugin`; anything else is `code: "bad_command"` |

### Binary PCM frame (server → client, during `transport: play`)

Little-endian, one frame per streamed block:

```
u32 trackIndex
f64 samplePos
f32[...] interleaved stereo samples
```

1024 samples per block at 48 kHz (`block_size` / `sample_rate` in
`src/hyperframes_vst/stream.py`'s `TrackStream`).

## Manual E2E verification checklist

Run through this after any change that touches the sidecar, the render
pipeline's VST bounce, or the Studio FX panel/preview path — it's the only
check that exercises native plugin windows and real audio playback, which
automated tests can't cover.

1. Load a composition with an audio track in Studio.
2. Add an EQ/effect to that track via the FX property panel.
3. Open the plugin's native editor window from the panel.
4. Twist a knob in the native editor.
5. Play the composition back and confirm you hear the change live (streamed
   processed audio, not the dry track).
6. Close the editor window — confirm the tweaked state persists to the
   track's `.vstchain.json` chain file (re-open the panel or reload the
   project and see the same parameter value).
7. Run `hyperframes render` on the same composition.
8. Confirm the rendered audio reflects the same processing character you
   heard live in preview (same effect, same rough parameter feel).
9. Delete or rename the plugin's bundle on disk (VST3/AU) so it can no
   longer be found.
10. Render the same composition again — confirm it **fails**, with an error
    naming the specific missing plugin (not a silent fallback to dry audio).
11. Attempt a Lambda cloud render (`hyperframes lambda render`) on the same
    composition — confirm it's rejected **before any AWS call**, with an
    error naming the track(s) carrying a VST chain (plugins can't run in
    Lambda; see the guard in `packages/cli/src/commands/lambda.ts`).
