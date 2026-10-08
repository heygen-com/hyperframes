# Source for lib/shaders.iife.js

One bundle drives all six shader blocks (`flowing-gradient`, `godrays`, `liquid-metal`, `marble`,
`mesh-gradient`, `nebula`). Each installs it into the project's shared compositions/lib folder, and the canvas's
`data-shader` attribute picks the shader.

- `driver.js` renders the canvas from HyperFrames time: on every `hf-seek` it steps the library's
  clock to that exact time, so preview and render draw the same frame.
- `build.mjs` bundles the driver with `shaders@4.0.0` and only these six shaders, then copies the
  result into each block's `lib/`.

## Build

```sh
npm ci
npm run build
```

`package-lock.json` pins every bundled package; their licenses are in
`../lib/shaders.THIRD-PARTY-LICENSES.txt`.
