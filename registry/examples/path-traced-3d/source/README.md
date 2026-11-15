# Source for the path-traced-3d example

These files stay in the repository; `hyperframes init --example path-traced-3d` installs only the
files listed in `../registry-item.json`.

## Rebuild the vendored bundle

`build.mjs` bundles `vendor-entry.js` with the versions pinned in `package.json` and
`package-lock.json` into `../assets/vendor/three-path-tracer.min.js`, and copies the three
licence files beside it.

```sh
npm ci
npm run build
```

Update the versions and the SHA-256 in `../assets/vendor/README.md` when they change.

## Check what reaches the pixels

`verify-render.mjs` copies the example to a temporary folder at 320x180, then uses the
HyperFrames CLI and ffmpeg to check, in raster and in path mode (2 samples per pixel):

- `hyperframes check` passes in path mode, so setup (including the first, slowest tracing run)
  resolves its `buildReady` promise;
- stills taken at 4 s, 0 s, then 4 s again in one page are byte-identical at 4 s, differ from
  0 s, and are not blank;
- a new page draws the same 4 s still (no grain that changes per page load);
- path mode draws different pixels from raster mode;
- every frame of an exported MP4 (raster: 1 s at 30 fps; path: 0.8 s at 10 fps on two workers)
  is not blank, the clip moves, and no step between neighbouring frames is more than 3x the
  typical step.

```sh
node verify-render.mjs
# or, from a HyperFrames checkout, with the CLI built from source:
HYPERFRAMES_CLI=packages/cli/bin/hyperframes.mjs node registry/examples/path-traced-3d/source/verify-render.mjs
```

Every command gets a 170 s readiness wait, because on a software GPU the tracer's first shader
run takes about a minute. It prints a JSON report with the wall time of every step. Set `KEEP_VERIFY_OUTPUT=1` to keep the
renders. `path-traced-3d.test.mjs` is the fast check that runs with the repository's script tests.
