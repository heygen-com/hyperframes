# Source for lib/shaders.iife.js

One bundle drives every shader block (the ones whose `lib/` holds `shaders.iife.js`). Each installs it into
the project's shared compositions/lib folder, and the canvas's `data-shader` attribute picks the shader.

- `driver.js` renders the canvas from HyperFrames time: on every `hf-seek` it steps the library's
  clock to that exact time, so preview and render draw the same frame.
- `build.mjs` bundles the driver with `shaders@4.0.0` and only the shaders it lists, then copies the
  result into each shader block's `lib/`. A new block adds its shader to that list.

## Build

```sh
npm ci
npm run build
```

`package-lock.json` pins every bundled package; their licenses are in
`../lib/shaders.THIRD-PARTY-LICENSES.txt`.
